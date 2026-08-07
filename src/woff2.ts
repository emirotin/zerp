import { brotliDecompressSync } from "node:zlib";

/**
 * Read the codepoints a woff2 face actually maps to a glyph.
 *
 * A face's `unicode-range` is a promise about which characters the browser
 * will consult it for, not a statement about which ones it can draw; the only
 * authority on that is the font's own `cmap`. Getting at it means walking
 * woff2's own container — the table directory uses a variable-length length
 * encoding and the tables themselves live in one brotli stream — but nothing
 * beyond Node's zlib is needed, and `cmap` is never one of the tables woff2
 * transforms, so it comes out of the stream as plain sfnt.
 */

// 'wOF2'
const SIGNATURE = 0x774f4632;
const HEADER_BYTES = 48;
const COLLECTION_FLAVOR = 0x74746366; // 'ttcf'

// woff2 spells the 63 common table tags as an index into this list; index 63
// means a literal 4-byte tag follows. The order is normative and four of the
// tags are space-padded, so it is written as one comma-separated string.
const KNOWN_TAGS =
  "cmap,head,hhea,hmtx,maxp,name,OS/2,post,cvt ,fpgm,glyf,loca,prep,CFF ,VORG,EBDT,EBLC,gasp,hdmx,kern,LTSH,PCLT,VDMX,vhea,vmtx,BASE,GDEF,GPOS,GSUB,EBSC,JSTF,MATH,CBDT,CBLC,COLR,CPAL,SVG ,sbix,acnt,avar,bdat,bloc,bsln,cvar,fdsc,feat,fmtx,fvar,gvar,hsty,just,lcar,mort,morx,opbd,prop,trak,Zapf,Silf,Glat,Gloc,Feat,Sill".split(
    ",",
  );

const MAX_CODEPOINT = 0x10ffff;

class Reader {
  readonly view: DataView;
  offset = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * woff2's variable-length unsigned integer: 7 bits per byte, most
   * significant first, high bit set on every byte but the last.
   */
  base128(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      if (i === 0 && byte === 0x80) {
        throw new Error("woff2: UIntBase128 with a leading zero");
      }
      if (value > 0x01ffffff) {
        throw new Error("woff2: UIntBase128 overflows 32 bits");
      }
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new Error("woff2: UIntBase128 longer than 5 bytes");
  }
}

interface TableEntry {
  tag: string;
  offset: number;
  length: number;
}

function readTableDirectory(reader: Reader, numTables: number): TableEntry[] {
  const entries: TableEntry[] = [];
  let offset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = reader.u8();
    const index = flags & 0x3f;
    const transformVersion = (flags >> 6) & 0x03;
    let tag: string;
    if (index === 63) {
      tag = String.fromCharCode(reader.u8(), reader.u8(), reader.u8(), reader.u8());
    } else {
      tag = KNOWN_TAGS[index] ?? `?${index}`;
    }
    const originalLength = reader.base128();
    // The null transform is version 3 for glyf and loca and version 0 for
    // every other table; only a transformed table states its stream length.
    const nullTransform = tag === "glyf" || tag === "loca" ? 3 : 0;
    const length = transformVersion === nullTransform ? originalLength : reader.base128();
    entries.push({ tag, offset, length });
    offset += length;
  }
  return entries;
}

function collectFormat4(view: DataView, start: number, into: Set<number>): void {
  const segCount = view.getUint16(start + 6) / 2;
  const endCodes = start + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  const glyphArrayEnd = start + view.getUint16(start + 2);

  for (let segment = 0; segment < segCount; segment++) {
    const end = view.getUint16(endCodes + segment * 2);
    const first = view.getUint16(startCodes + segment * 2);
    const delta = view.getInt16(idDeltas + segment * 2);
    const rangeOffset = view.getUint16(idRangeOffsets + segment * 2);
    if (first > end || first === 0xffff) {
      continue;
    }
    for (let code = first; code <= end; code++) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        // The offset is measured from the idRangeOffset slot itself, which is
        // what lets the glyph array trail the segment arrays.
        const at = idRangeOffsets + segment * 2 + rangeOffset + (code - first) * 2;
        if (at + 1 >= glyphArrayEnd || at + 1 >= view.byteLength) {
          continue;
        }
        glyph = view.getUint16(at);
        if (glyph !== 0) {
          glyph = (glyph + delta) & 0xffff;
        }
      }
      if (glyph !== 0) {
        into.add(code);
      }
    }
  }
}

function collectFormat12(view: DataView, start: number, into: Set<number>): void {
  const groups = view.getUint32(start + 12);
  for (let group = 0; group < groups; group++) {
    const at = start + 16 + group * 12;
    if (at + 12 > view.byteLength) {
      return;
    }
    const first = view.getUint32(at);
    const end = Math.min(view.getUint32(at + 4), MAX_CODEPOINT);
    const startGlyph = view.getUint32(at + 8);
    for (let code = first; code <= end; code++) {
      if (startGlyph + (code - first) !== 0) {
        into.add(code);
      }
    }
  }
}

/** Codepoints an sfnt `cmap` table maps to a non-zero glyph. */
export function cmapCodepoints(table: Uint8Array): Set<number> {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const codepoints = new Set<number>();
  const subtables = view.getUint16(2);
  const seen = new Set<number>();
  for (let i = 0; i < subtables; i++) {
    const record = 4 + i * 8;
    if (record + 8 > view.byteLength) {
      break;
    }
    const offset = view.getUint32(record + 4);
    if (seen.has(offset) || offset + 2 > view.byteLength) {
      continue;
    }
    seen.add(offset);
    // Formats 4 and 12 are the two the web has standardized on: every woff2
    // Google Fonts ships uses one or both. Anything else is left alone rather
    // than guessed at.
    const format = view.getUint16(offset);
    if (format === 4) {
      collectFormat4(view, offset, codepoints);
    } else if (format === 12) {
      collectFormat12(view, offset, codepoints);
    }
  }
  return codepoints;
}

/** Codepoints a woff2 font maps to a glyph. */
export function woff2Codepoints(data: Uint8Array): Set<number> {
  const reader = new Reader(data);
  if (reader.u32() !== SIGNATURE) {
    throw new Error("woff2: not a woff2 file");
  }
  const flavor = reader.u32();
  if (flavor === COLLECTION_FLAVOR) {
    throw new Error("woff2: font collections are not supported");
  }
  const numTables = reader.view.getUint16(12);
  const compressedLength = reader.view.getUint32(20);

  reader.offset = HEADER_BYTES;
  const tables = readTableDirectory(reader, numTables);
  const cmap = tables.find((table) => table.tag === "cmap");
  if (!cmap) {
    throw new Error("woff2: no cmap table");
  }

  const compressed = data.subarray(reader.offset, reader.offset + compressedLength);
  const stream = brotliDecompressSync(compressed);
  if (cmap.offset + cmap.length > stream.length) {
    throw new Error("woff2: cmap table runs past the decompressed stream");
  }
  return cmapCodepoints(stream.subarray(cmap.offset, cmap.offset + cmap.length));
}

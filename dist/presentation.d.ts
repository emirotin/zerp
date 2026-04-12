export interface BuildOptions {
    rootDir: string;
    title?: string;
    lang?: string;
    outFile?: string;
}
interface SlideFile {
    absolutePath: string;
    relativePath: string;
}
export declare function listSlides(rootDir: string): Promise<SlideFile[]>;
export declare function buildPresentationHtml(options: BuildOptions): Promise<string>;
export declare function writePresentation(options: BuildOptions): Promise<string>;
export {};

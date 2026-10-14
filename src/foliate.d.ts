// foliate-js 没有自带类型声明，这里只声明用到的部分
declare module 'foliate-js/epub.js' {
  export interface FoliateTocItem {
    label?: string
    href: string
    subitems?: FoliateTocItem[] | null
  }
  export interface FoliateSection {
    id?: unknown
    createDocument(): Document | Promise<Document>
    load?(): string | Promise<string>
    linear?: string
    size?: number
  }
  export interface FoliateResolved {
    index: number
    anchor: (doc: Document) => unknown
  }
  export interface FoliateBook {
    sections: FoliateSection[]
    toc?: FoliateTocItem[]
    metadata?: Record<string, unknown>
    rendition?: { layout?: string }
    resolveHref(href: string): FoliateResolved | null | undefined | Promise<FoliateResolved | null | undefined>
    getCover?(): Blob | null | undefined | Promise<Blob | null | undefined>
    destroy?(): void
  }
  export interface FoliateLoader {
    loadText(name: string): string | null | Promise<string | null>
    loadBlob(name: string): Blob | null | Promise<Blob | null>
    getSize(name: string): number
  }
  export class EPUB {
    constructor(loader: FoliateLoader)
    init(): Promise<FoliateBook>
  }
}

declare module 'foliate-js/mobi.js' {
  import type { FoliateBook } from 'foliate-js/epub.js'
  export function isMOBI(file: Blob): Promise<boolean>
  export class MOBI {
    constructor(options: { unzlib: (data: Uint8Array) => Uint8Array })
    headers?: { palmdoc?: { encryption?: number } }
    open(file: Blob): Promise<FoliateBook>
  }
}

declare module 'foliate-js/fb2.js' {
  import type { FoliateBook } from 'foliate-js/epub.js'
  export function makeFB2(blob: Blob): Promise<FoliateBook>
}

import { DB as sqliteDB } from "sqlite";

export class Page {
    url: string;
    isHtml: boolean;
    data?: Uint8Array;
    errorId?: number;
    [key: string]: unknown;
    
    constructor(url: string, data?: Uint8Array, isHtml?: boolean, errorId?: number) {
        if (!data && !errorId) {
            throw new Error("Page must have data or an error")
        }
        this.url = url
        this.data = data
        if (data && (isHtml === undefined)) {
            throw new Error("Page must have isHtml if it has data")
        } 
        this.isHtml = isHtml || false;
        this.errorId = errorId
    }
}

export interface Link {
    origin: number,
    target: number,
    [key: string]: unknown
}

export interface Error {
    id: number,
    http_code?: number,
    message?: string,
    [key: string]: unknown
}

export class DB extends sqliteDB {
    constructor() {
        super("test/test.db");
        this.execute(`
            CREATE TABLE IF NOT EXISTS pages (
                url TEXT NOT NULL PRIMARY KEY,
                isHtml BOOLEAN NOT NULL,
                data BLOB,
                error INTEGER REFERENCES errors(id),
                UNIQUE(url)
            );
            CREATE TABLE IF NOT EXISTS links (
                origin INTEGER NOT NULL REFERENCES pages(id),
                target INTEGER NOT NULL REFERENCES pages(id),
                UNIQUE(origin, target),
                PRIMARY KEY(origin, target)
            );
            CREATE TABLE IF NOT EXISTS errors (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                http_code INTEGER UNIQUE,
                message TEXT UNIQUE
            );
        `)
    }

    getPageByUrl(url: string): Page | undefined {
        const data = this.queryEntries<Page>("SELECT * FROM pages WHERE url = ?", [url])[0]
        if (!data) {
            return undefined
        }
        return data
    }

    createPage(page: Page) {
        if (!page.data && !page.errorId) {
            throw new Error("Page must have data or an error")
        } else if (page.data && page.errorId) {
            this.query("INSERT INTO pages (url, isHtml, data, error) VALUES (?, ?, ?, ?)", [page.url, page.isHtml, page.data, page.errorId])
        } else if (page.data) {
            this.query("INSERT INTO pages (url, isHtml, data) VALUES (?, ?, ?)", [page.url, page.isHtml, page.data])
        } else {
            this.query("INSERT INTO pages (url, isHtml, error) VALUES (?, ?, ?)", [page.url, page.isHtml, page.errorId])
        }
    }

    getErrorByCode(code: number): Error | undefined {
        const data = this.queryEntries<Error>("SELECT * FROM errors WHERE http_code = ?", [code])[0]
        if (!data) {
            return undefined
        }
        return data
    }

    createError(code: number, message?: string): Error {
        if (!code && !message) {
            throw new Error("Error must have a code or a message")
        }
        this.query("INSERT INTO errors (http_code, message) VALUES (?, ?)", [code, message])
        return this.getErrorByCode(code)!
    }
}
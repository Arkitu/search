import * as cheerio from "cheerio";
import * as fs from "std/fs/mod.ts";
import { join, parse as pathParse } from "std/path/mod.ts";
import { red, yellow } from "std/fmt/colors.ts";
import { DB } from "sqlite";

const OUT_DIR = "./test"
const MAX_OPEN_FILES = 512
const fileNameCharLimit = 250

const DOWNLOAD_PER_SECOND = 100

interface Page {
    url: string,
    html: string,
    error?: number,
    [key: string]: any
}

interface Link {
    origin: number,
    target: number,
    [key: string]: any
}

interface Error {
    id: number,
    http_code?: number,
    message?: string,
    [key: string]: any
}

function initDB(): DB {
    const db = new DB("test/test.db")
    db.execute(`
        CREATE TABLE IF NOT EXISTS pages (
            url TEXT NOT NULL PRIMARY KEY,
            html TEXT,
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
    return db
}

function getPageByUrl(url: string): Page | undefined {
    const data = db.queryEntries<Page>("SELECT * FROM pages WHERE url = ?", [url])[0]
    if (!data) {
        return undefined
    }
    return data
}

function createPage(url: string, html?: string, error?: number): Page {
    
}

function getErrorByCode(code: number): Error | undefined {
    const data = db.queryEntries<Error>("SELECT * FROM errors WHERE http_code = ?", [code])[0]
    if (!data) {
        return undefined
    }
    return data
}

function createError(code: number, message?: string): Error {
    if (!code && !message) {
        throw new Error("Error must have a code or a message")
    }
    db.query("INSERT INTO errors (http_code, message) VALUES (?, ?)", [code, message])
    return getErrorByCode(code)!
}

const db = initDB()

// Timestamp of last promise
let lastDownload = 0
let openFiles = 0

const target = Deno.args[0];

const errorsPaths: string[] = []
const errorsCount:{
    unknown: {
        [key: string]: number
    },
    http: {
        [key: number]: number
    },
    fileNameTooLong: number
} = {
    unknown: {},
    http: {},
    fileNameTooLong: 0
}

function extractLinks($: cheerio.CheerioAPI, element: cheerio.BasicAcceptedElems<cheerio.Element>): string[] {
    const links = []
    const el = $(element)
    const href = el.attr('href')
    if (href) {
        links.push(href)
    }
    for (const chi of el.children()) {
        links.push(...extractLinks($, chi))
    }
    return links
}

function extractLinksFromHtml(html: string): string[] {
    const $ = cheerio.load(html)

    return extractLinks($, 'body')
}

async function fetchUrl(url: string): Page {
    // Check if url is in db
    const page = getPageByUrl(url)
    if (page) {
        return page
    }

    console.log("Downloading " + url);

    // Fetch url
    const data = await fetch(url)
    if (!data.ok) {
        console.error(yellow("HTTP Error when fetching " + url + " : " + data.status + " " + data.statusText));
        let error = getErrorByCode(data.status) || createError(data.status)
        
    }

async function downloadUrl(url: string) {
    if (errorsPaths.includes(url) || await fs.exists(url)) {
        return
    }
    let path = join(OUT_DIR, url)
    await Deno.mkdir(path, {recursive: true})

    console.log("Downloading " + url);

    let data: Response
    try {
        data = await fetch(url)
    } catch (e) {
        errorsPaths.push(url)
        console.error(red("Unknown Error when fetching " + path + " : " + e.message));
        errorsCount.unknown[e.message] = (errorsCount.unknown[e.message] || 0) + 1
        return
    }

    if (!data.ok) {
        errorsPaths.push(url)
        console.error(yellow("HTTP Error when fetching " + path + " : " + data.status + " " + data.statusText));
        errorsCount.http[data.status] = (errorsCount.http[data.status] || 0) + 1
        return
    }

    const isHTML = data.headers.get("content-type")?.includes("text/html")

    if (isHTML) {
        path = join(path, "index.html")
        while (openFiles > MAX_OPEN_FILES) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        openFiles++
        const file = await Deno.create(path)
        await data.body?.pipeTo(file.writable)
        return extractLinksFromHtml(await Deno.readTextFile(path))
    } else {
        while (openFiles > MAX_OPEN_FILES) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        openFiles++
        const file = await Deno.create(path)
        await data.body?.pipeTo(file.writable)
    }
    openFiles--
    lastDownload = Date.now()
}

async function downloadUrlRecursive(url: string) {
    if (pathParse(url).base.length > fileNameCharLimit) {
        console.error(red("Filename too long for " + url));
        errorsCount.fileNameTooLong++
        return
    }
    try {
        if (await fs.exists(url)) {
            return
        }
    } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
            // ignore
        } else {
            throw e
        }
    }

    const links = await downloadUrl(url);

    if (!links) {
        return
    }

    const promises: Promise<void>[] = []

    for (const link of links) {
        if (link.startsWith("/")) {
            promises.push(
                new Promise(resolve => {
                    setTimeout(async () => {
                        await downloadUrlRecursive(join(target, link))
                        resolve()
                    }, Math.max(0, lastDownload + (1000 / DOWNLOAD_PER_SECOND) - Date.now()))
                })
            )
            
            // promises.push(downloadUrlRecursive(join(url, link)))
            // downloadUrlRecursive(join(url, link))
        }
    }

    await Promise.all(promises)
}

console.debug(await downloadUrlRecursive(target))

console.log("\n\nDownload finished !")

console.log("\nErrors:")
console.log(errorsCount)
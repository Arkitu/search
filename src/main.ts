import * as cheerio from "cheerio";
import * as fs from "std/fs/mod.ts";
import { dirname, join } from "std/path/mod.ts";

const OUT_DIR = "./test"

const target = Deno.args[0];

const errorsPaths: string[] = []

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

async function downloadUrl(url: string) {
    if (errorsPaths.includes(url) || await fs.exists(url)) {
        return
    }
    let path = join(OUT_DIR, url)
    await Deno.mkdir(path, {recursive: true})

    const data = await fetch(url)

    if (!data.ok) {
        errorsPaths.push(url)
        console.error("HTTP Error when fetching " + path + " : " + data.status + " " + data.statusText);
        return
    }

    const isHTML = data.headers.get("content-type")?.includes("text/html")

    if (isHTML) {
        path = join(path, "index.html")
        const file = await Deno.create(path)
        await data.body?.pipeTo(file.writable)
        return extractLinksFromHtml(await Deno.readTextFile(path))
    } else {
        const file = await Deno.create(path)
        await data.body?.pipeTo(file.writable)
    }
}

async function downloadUrlRecursive(url: string) {
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

    //const promises: Promise<void>[] = []

    for (const link of links) {
        if (link.startsWith("/")) {
            // promises.push(downloadUrlRecursive(join(url, link)))
            downloadUrlRecursive(join(url, link))
        }
    }

    //await Promise.all(promises)
}

console.debug(await downloadUrlRecursive(target))
#!/usr//bin/node

/*
 * reads/updates the strips
 *
 * reader.js <comic>
 * where <comic> is one of the json files in config/
 *
 * For creating a new comic:
 * - set config.debugMaxIterations in readConfig() to a small value
*/

const fetch = require('node-fetch')
const cheerio = require('cheerio')
const fs = require('fs')
const {promisify} = require('util')
const path = require('path')
const requestImageSize = require('request-image-size')
const sizeOfImage = promisify(require('image-size'))
const {createWriteStream} = require('fs')
const {pipeline} = require('stream')
const css = require('css')
const winston = require('winston')

async function terminate(errlevel) {
    process.nextTick(function () { process.exit(errlevel) })
}

// ---- trap the SIGINT and reset before exit
process.on('SIGINT', function () {
    console.log("Bye, Bye...")
	terminate(0)
})

process.on('error', (err) => {
	console.error("Unhandled error, terminating")
	console.error(err)
    terminate(0)
})

process.on('unhandledRejection', (reason, promise) => {
	if (logger) logger.error("Unhandled Async Rejection at %o, reason %o", promise, reason)
    terminate(0)
})
function terminate(msg, errno = 1) {
	console.log(msg)
	process.exit(errno)
}

let config = {
	// place default values here, overwritten by comic config file
	refetchAmount: 1,
    logger: {
        main: 'debug',
    },
}
let configOverride = { // use for debugging
//	refetchAmount: 2,
//	debugMaxIterations: 3,
}

function addNamedLogger(name, level = 'debug', label = name) {
    let { format } = require('logform');
	let prettyJson = format.printf(info => {
	  if (info.message.constructor === Object) {
		info.message = JSON.stringify(info.message, null, 4)
	  }
	  return `${info.timestamp} [${info.level}]\t[${info.label}]\t${info.message}`
	})
	let getFormat = (label, colorize = false) => {
		let nop = format((info, opts) => { return info })
		return format.combine(
			colorize ? format.colorize() : nop(),
			format.timestamp({
				format: 'YYYY-MM-DD HH:mm:ss',
			}),
			format.label({ label: label }),
			format.splat(),
			prettyJson
			)
	}
	winston.loggers.add(name, {
	  level: level,
	  transports: [
		new winston.transports.Console({
			format: getFormat(label, true),
		}),
		new winston.transports.File({ 
			format: getFormat(label, false),
			filename: 'winston.log'
		})
	  ]
	})
}

// prepareNamedLoggers
(()=>{
	Object.keys(config.logger).forEach(name => {
		let level = config.logger[name]
		addNamedLogger(name, level)
	})
})()
const logger = winston.loggers.get('main')


async function readConfig() {
	let stripname = process.argv[2]
	if (!stripname) {
		terminate("Please specify strip name as argument")
	}
	let match = stripname.match(new RegExp("^[a-zA-Z0-9]+$"))
	if (!match) {
		terminate("Given strip name is invalid")
	}
	let sConfigFile = stripname + '.json'
	console.log("Loading config " + sConfigFile)
	let configBuffer = fs.readFileSync(path.resolve(__dirname, 'config', sConfigFile), 'utf-8')
	config = { ...config, ...JSON.parse(configBuffer), ...configOverride }

    // manual function mapping, for security or something...
	if (config.parser == "parseTwb") config.parser = parseTwb
	if (config.parser == "parseSS") config.parser = parseSS
	if (config.parser == "parseOOTS") config.parser = parseOOTS
	if (config.parser == "parseChupa") config.parser = parseChupa
	if (config.parser == "parseTD") config.parser = parseTD
	if (config.parser == "parseCF") config.parser = parseCF
	if (config.parser == "parseSW") config.parser = parseSW
    if (!(config.parser instanceof Function)) {
        terminate("Please update parser mapping in readConfig() for " + config.parser)
    }
}

// fetches the given URL and returns the result text
async function getComic(url) {
	try {
//		console.log("Loading URL " + url)
		let res = await fetch(url)
//		console.log("Got: " + res.status)
		return await res.text()
	} catch(e) {
		console.log("Error loading " + url)
		console.log(e)
	}
}

const basepath = path.dirname(require.main.filename) + "/"
var comicData = []
var lastEntry

async function loadData() {
	console.log("Loading data from " + config.targetFilename)
	try {
		var jsonp = await promisify(fs.readFile)(basepath + config.targetFilename, 'utf8')
	} catch (error) {
		if (error.code == 'ENOENT') {
			console.log("Data file doesn't exist - creating new one")
		} else {
			console.log("Couldn't load data file - creating new one")
			console.log(error)
		}
		return { currentUrl: config.startUrl, idx: 1 }
	}
	if (jsonp.trim() == "") {
		console.log("Data file is empty")
		return { currentUrl: config.startUrl, idx: 1 }
	}
	let match = jsonp.match(new RegExp("^\\s*" + config.outputJsonPName + "\\s*\\(\\s*(.*)\\s*\\)\\s*$", "s"))
	if (!match) {
		terminate("Existing file did not match expected jsonp structure")
	}
	let json = match[1]
	comicData = JSON.parse(json)

	let lastIdx = comicData[comicData.length-1].i

    // remove last index, to get a working url (for twb, "today" doesn't follow the pattern of image src and html being the same filename)
	let restartIdx = Math.max(1, lastIdx - config.refetchAmount)

	console.log("Strips up to index " + lastIdx + " known. Start fetching from index " + restartIdx + ".")

	lastEntry = {}
	let deleteFromIdx = comicData.length
	for(j = 0; j < comicData.length; j++) {
		entry = comicData[j]
		if (entry.i > restartIdx) {
			deleteFromIdx = j
			break
		}
		lastEntry = { ...lastEntry, ...entry }
//		for(let field in entry) {
//			lastEntry[field] = entry[field]
//		}
	}

	// remove entries which we want to refetch
	comicData.splice(deleteFromIdx)

	console.log("Last data point used is:")
	console.log(comicData[comicData.length-1])
	console.log("'Last Entry' is calculated as:")
	console.log(lastEntry)
	let padNum = lastEntry.numlen > 0 ? ("0000000000000000"+(restartIdx+lastEntry.idxoffset)).slice(-lastEntry.numlen) : ''
	currentUrl = lastEntry.pageUrl ? lastEntry.pageUrl : lastEntry.prefix + padNum + config.htmlSuffix
	idx = restartIdx
	return { currentUrl, idx }
}

// see https://loige.co/emerging-javascript-pattern-multiple-return-values/
// returns imgsrc, nextUrl, newEntry
async function parseTwb($) {
	let imgsrc = null
	let nextUrl = null
	let newEntry = {
	}
	$("a img").each(function(idx, data) {
		// every strip has "next" except the current and last one. Last one has "today", current has neither and no <a>-tag
		if (data.attribs.src == "next.png" || data.attribs.src == "today.png") {
			let children = data.parent.parent.children
			dance:
			for(i = 0; i < children.length; i++) {
				let child = children[i]
				if (child.type == 'tag' && child.name == 'a') {
					nextUrl = child.attribs.href
					let children2 = child.children
					for(j = 0; j < children2.length; j++) {
						let child2 = children2[j]
						if (child2.type == 'tag' && child2.name == 'img') {
							imgsrc = child2.attribs.src
							break dance
						}
					}
				} else if (child.type == 'text' && child.data.trim() != '') {
					newEntry.title = child.data
				}
			}
		}
	})
	// no imgsrc? Then we are on "today"
	if (!imgsrc) {
		$("a img").each(function(idx, data) {
			if (data.attribs.src == "first.png") {
				let children = data.parent.parent.children
				for(i = 0; i < children.length; i++) {
					let child = children[i]
					if (child.type == 'tag' && child.name == 'img') {
						imgsrc = child.attribs.src
						break
					} else if (child.type == 'text' && child.data.trim() != '') {
						newEntry.title = child.data
					}
				}
			}
		})
	}
	return { imgsrc, nextUrl, newEntry }
}

// returns imgsrc, nextUrl, newEntry
async function parseSS($) {
	let imgsrc = null
	let nextUrl = null
	imgsrc = $("img.comic-image")[0].attribs.src
	let nextLink = $("a.next")
	if (nextLink && nextLink[0]) {
		nextUrl = $("a.next")[0].attribs.href
	}
	let title = $("article h1")[0].children[0].data
	let newEntry = {
		title: title
	}
	return { imgsrc, nextUrl, newEntry }
}

// returns imgsrc, nextUrl, newEntry
async function parseSW($) {
    let fetchNextLinkIdFromCss = async (cssobj) => {
        if (!cssobj) throw new Error('fetchFromCss: got no css obj')
        if (cssobj.type != "stylesheet") throw new Error('fetchFromCss: top level object type is not "stylesheet"')
        if (cssobj.stylesheet.parsingErrors.length > 0) { logger.error('fetchFromCss: parsing errors: %o', cssobj.stylesheet.parsingErrors); throw new Error('fetchFromCss: stylesheet has parsing errors') }
        if (!cssobj.stylesheet.rules) throw new Error('fetchFromCss: stylesheet contains no rules')
        let rules = cssobj.stylesheet.rules.filter(rule => rule.declarations.filter(dec => dec.property == 'background' && dec.value.startsWith('transparent url') && dec.value.includes('next')).length > 0)
        if (rules.length == 0) throw new Error('fetchFromCss: no css rule for "next" link found')
        if (rules.length > 1) logger.info('fetchFromCss: multiple css rules for "next" link found, using first one')
        if (rules[0].selectors.length > 1) logger.info('fetchFromCss: multiple selectors for css rule for "next" link found, using first one')
        let id = rules[0].selectors[0]
        return id
    }
    
    
	let pagesheetElement = $("#pagesheet")[0]
	if (!pagesheetElement) {
		console.log('sw: pagesheet link not found')
		return
	}
    let pagesheetUrl = pagesheetElement.attribs.href
	logger.info("  reading pagesheet css at %s", pagesheetUrl)
	let pagesheet = await getComic(config.baseUrl + pagesheetUrl)
    let cssobj = css.parse(pagesheet, { source: pagesheetUrl })
    let nextId = await fetchNextLinkIdFromCss(cssobj)
    logger.debug('parseSW: id for "next" link: %s', nextId)
	let nextEl = $(nextId)[0]
	let nextUrl = null
    if (nextEl && nextEl.attribs.href.startsWith('slack-wyrm') && !nextEl.attribs.href.endsWith('.html')) nextUrl = nextEl.attribs.href
	let imgsrcs = Object.values($("img")).filter(img => img?.attribs?.id && img.attribs.id.endsWith('_img') && !img.attribs.src.includes('banner')).map(img => img.attribs.src)
	if (!imgsrcs || imgsrcs.length == 0) throw new Error('parseSW: no images found on page')

	let newEntry = {
		title: '' // only shown in the archive overview page
	}
    console.log('imgsrcs', imgsrcs)
    let imgsrc = imgsrcs[0]
	return { imgsrc, nextUrl, newEntry }
}

// returns imgsrc, nextUrl, newEntry
async function parseChupa($) {
	let imgsrc = null
	let nextUrl = null
    $("a img").each(function(idx, data) {
        if (data.attribs.src.endsWith("/button-next.png") && !data.parent.attribs.href.endsWith("archive.html")) {
            nextUrl = data.parent.attribs.href
        }
    })
	imgsrc = $("p img")[0].attribs.src
	let newEntry = {
	}
	return { imgsrc, nextUrl, newEntry }
}

// returns imgsrc, nextUrl, newEntry
async function parseOOTS($) {
	let imgsrc = null
	let nextUrl = null
	let newEntry = {
	}
	$("table img").each(function(idx, data) {
		// no easy anchor for the actual image
		if (data.attribs.src.startsWith("/comics/images")) {
			imgsrc = data.attribs.src
			if (nextUrl == '#') {
				nextUrl = null
			}
		}
	})
	$("a img").each(function(idx, data) {
		// every strip has "next", including the current one. Current one points to '#', though
		if (data.attribs.src == "/Images/redesign/ComicNav_Next.gif") {
			nextUrl = data.parent.attribs.href
			if (nextUrl == '#') {
				nextUrl = null
			}
		}
	})
	return { imgsrc, nextUrl, newEntry }
}

// returns imgsrc, nextUrl, newEntry
async function parseTD($) {
	let imgsrc = null
	let nextUrl = null
	let alt = null
	let title = null
	// ensure we get the <a> which is around the image
	$("#comic a img").each(function(idx, data) {
		if (!nextUrl) {
			nextUrl = data.parent.attribs.href
		}
	})
	$("#comic img").each(function(idx, data) {
		if (!imgsrc) {
			imgsrc = data.attribs.src
			alt = data.attribs.title
		}
	})
	$("h2.post-title").each(function(idx, data) {
		title = data.children[0].data
	})
	let newEntry = {
		title: title + " (" + alt + ")"
	}
	return { imgsrc, nextUrl, newEntry }
}

async function parseCF($) {
	let imgsrc = null
	let nextUrl = null
    $("a.next").each(function(idx, data) {
        nextUrl = data.attribs.href
    })
	$("div.comic_title").each(function(idx, data) {
		title = data.children[0].data
	})
	imgsrc = $("img.comicimage")[0].attribs.src
	let newEntry = {
		title: title
	}
	return { imgsrc, nextUrl, newEntry }
}

async function downloadFile(url, path) {
	return  promisify(pipeline)((await fetch(url)).body, createWriteStream(path))
}

async function update(startUrl, startIdx) {
	let currentUrl = startUrl
	let idx = startIdx
	let iterationCount = 0
	console.log("Starting update at " + currentUrl + " with idx=" + idx)

	while (currentUrl) {
		console.log("Parsing page at " + currentUrl)
		let page = await getComic(config.baseUrl + currentUrl)
		let $ = cheerio.load(page)

		let prev = null
		let { imgsrc, nextUrl, newEntry } = await config.parser($)

        if (!imgsrc) {
			terminate("No imgsrc found.")
		}

        // for pages which link to absolute URLs: remove the baseUrl
        if (imgsrc.startsWith(config.baseUrl)) { imgsrc = imgsrc.substr(config.baseUrl.length) }
        if (nextUrl && nextUrl.startsWith(config.baseUrl)) { nextUrl = nextUrl.substr(config.baseUrl.length) }
        if (imgsrc.match(/https?:/i)) {
            terminate("imgsrc url seems to be absolute (and differing from baseurl): " + imgsrc)
        }
        if (nextUrl && nextUrl.match(/https?:/i)) {
            terminate("nextUrl url seems to be absolute (and differing from baseurl): " + nextUrl)
        }

		let size
		if (config.downloadFolder) {
			let path = config.downloadFolder + '/' + /[^/]*$/.exec(imgsrc)[0].replace(/([?#].*)/, '').replace(/%20/g, ' ')
			console.log("Downloading image " + imgsrc + " to " + path)
			await downloadFile(config.baseUrl + imgsrc, path)

			console.log("Getting image dimensions for " + imgsrc)
			size = await sizeOfImage(path)
		} else { // seems not to work anymore?
			console.log("Getting image dimensions for " + imgsrc)
			try {
				size = await requestImageSize(config.baseUrl + imgsrc)
			} catch (error) {
				console.log("requestImageSize(" + config.baseUrl + imgsrc + ") failed:")
				console.log(error)
				process.exit(1)
			}
		}
		let parts = imgsrc.match(/^(.*?)([0-9]*)(\.[a-z]+)?$/)
		let prefix = parts[1]
		let numlen = parts[2].length
		let idxoffset = parts[2] - idx
		let ext = parts[3] || ""
		let baseEntry = {
			"i": idx,
			"w": size.width,
			"h": size.height,
			"prefix": prefix,
			"numlen": numlen,
			"idxoffset": idxoffset,
			"ext": ext,
			"pageUrl": currentUrl
		}
		newEntry = { ...baseEntry, ...newEntry }
console.log(newEntry)
		// create new entry based only on changes between newEntry and lastEntry
		entry = {}
		entry.i = newEntry.i
		if (lastEntry) {
			let keys = Object.keys(newEntry)
			keys.forEach(key => {
				if (newEntry[key] != lastEntry[key]) {
					entry[key] = newEntry[key]
				}
			})
			if (Object.entries(entry).length > 1) {
				comicData.push(entry)
			}
		} else {
			comicData.push(newEntry)
		}
		lastEntry = newEntry

		if (!nextUrl) {
			console.log("No next url found.")
		}
		currentUrl = nextUrl

		idx++
		iterationCount++

		// runaway break, used for debugging
		if (iterationCount >= config.debugMaxIterations) {
			console.log("DEBUG BREAK: stopping crawling after " + iterationCount + " iterations, reached idx=" + idx)
			break
		}

		// save every 10 images
		if (iterationCount % 10 == 0) {
			await writeData()
		}
	}

	// ensure last entry is written, even if nothing besides the id changed
	if (comicData[comicData.length-1].i < lastEntry.i) {
		comicData.push({"i":lastEntry.i})
	}

}

async function writeData() {
	let json = JSON.stringify(comicData);
	let jsonp = config.outputJsonPName + "(\n" + json + ")\n"
	jsonp = jsonp.replace(/},/g, "},\n")
	let last = comicData[comicData.length-1]
	console.log("Writing to " + config.targetFilename + ": " + comicData.length + " entries, last is idx=" + last.i)
	await promisify(fs.writeFile)(basepath + config.targetFilename, jsonp, 'utf8')
}

async function run() {
	await readConfig()
	let { currentUrl, idx } = await loadData()
	await update(currentUrl, idx)
	await writeData()
	console.log("Done")
}

run()

/**
 * # Feed Reader Module
 *
 * [![Build Status](https://travis-ci.org/nxus/feedreader.svg?branch=master)](https://travis-ci.org/nxus/feedreader)
 *
 * Use feedparser to parse and process RSS/Atom feeds.
 *
 * ## Installation
 *
 *     > npm install nxus-feedreader --save
 *
 * ## Configuration Options
 *
 *     "feedreader": {
 *       "interval": 0, // seconds
 *       "enableQueues": false,
 *       "enableReadTracking": true,
 *       "feeds"": {
 *          name: URL
 *       }
 *     }
 *
 * ## Usage
 *
 * ### Register a feed
 *
 * For each feed to process, register its URL with a identifying name
 *
 *
 * ```
 * import {feedreader} from 'nxus-feedreader'
 * 
 * feedreader.feed("my-feed", "https://www....")
 * ```
 *
 * ### Process new/updated items
 *
 * See the [feedreader docs](https://github.com/danmactough/node-feedparser#list-of-article-properties) for item fields.
 *
 * ```
 * import {feedreader} from 'nxus-feedreader'
 * 
 * feedreader.process("my-feed", (item, meta, ident) => {
 *   // item and meta are from feedreader, ident is 'my-feed'   
 * })
 * ```
 *
 * You may also process all incoming items regardless of feed
 *
 * ```
 * feedreader.process((item, ident) => { })
 * ```
 *
 * ### Fetch feed contents for processing
 *
 * If `interval` config is defined (in seconds), feed will automatically be fetched that often. You may manually
 * request a fetch (e.g. on startup or from a user action) by calling `fetch`
 *
 * ```
 * feedreader.fetch()
 * ```
 *
 * ### Run fetch and processing in background worker queues
 *
 * If you would like fetching and processing to happen in the background, set the `enableQueues` config or
 * during initialization call:
 *
 * ```
 * feedreader.enableQueues()
 * ```
 *
 * # API
 * ----
 */

'use strict';

import Promise from 'bluebird'
import {workerQueue} from 'nxus-worker-queue'
import request from 'request'
import FeedParser from 'feedparser'
import _ from 'underscore'

import {application as app} from 'nxus-core'
import {HasModels} from 'nxus-storage'

/**
 * Feedreader module for parsing and processing RSS/Atom Feeds
 */
class FeedReader extends HasModels {
  constructor() {
    super()

    this._feeds = {}
    this._processors = {}
    
    app.onceAfter('load', () => {
      if (this.config.enableQueues) {
        this._setupQueues()
      }
      if (Object.keys(this.config.feeds).length > 0) {
        for (let key in this.config.feeds) {
          this.feed(key, this.config.feeds[key])
        }
      }
    })

    this._intervalId = null
    app.onceAfter('launch', ::this._setupTimer)
    app.once('stop', () => {
      if(this._intervalId) clearInterval(this._intervalId)
    })
     
    
    
  }

  defaultConfig() {
    return {
      interval: 0,
      enableQueues: false,
      enableReadTracking: true,
      feeds: {}
    }
  }

  /**
   * Creates the timer, set to run at the interval specified by config
   */
  _setupTimer() {
    if (this.config.interval > 0) {
      this._intervalId = setInterval(::this.fetch, this.config.interval)
    }
  }  

  /**
   * Register a feed
   * @param {string} ident identifier for this feed
   * @param {string} url feed URL
   * @param {object} options tbd
   */
  feed(ident, url, options={}) {
    this._feeds[ident] = Object.assign({url, ident}, options)
  }

  /**
   * Process feed items
   * @param {string} [ident] identifier for this feed
   * @param {function} handler (item, ident) handler function
   */
  process(ident, handler=null) {
    if (handler == null) {
      handler = ident
      ident = null
    }

    if (!this._processors[ident]) {
      this._processors[ident] = []
    }
    this._processors[ident].push(handler)
  }

  /**
   * Fetch one or all feeds
   * @param {string} [ident] identifier for this feed
   */
  fetch(ident) {
    return this._callOrQueue('fetch', {ident})
  }

  /**
   * Enable queue processing
   */
  enableQueues() {
    this.config.enableQueues = true
  }
  
  _setupQueues() {
    workerQueue.worker('feedreader-fetch', ::this._fetch)
    workerQueue.worker('feedreader-fetchFeed', ::this._fetchFeed)
    workerQueue.worker('feedreader-processItem', ::this._processItem)
  }

  _callOrQueue(action, data) {
    if (this.config.enableQueues) {
      return workerQueue.task(`feedreader-${action}`, data)
    } else {
      return this[`_${action}`](data)
    }
  }

  _fetch({ident}) {
    if (ident) {
      return this._callOrQueue('fetchFeed', this._feeds[ident])
    } else {
      return Promise.map(this._feeds, (key) => {
        return this._callOrQueue('fetchFeed', this._feeds[key])
      })
    }
  }

  _fetchFeed({url, ident}) {
    // streaming response pipes is discouraged with request-promise, so raw request lib here

    return new Promise(async (resolve, reject) => {
      let feedparser = await this._createParser(url, ident, resolve, reject)
      
      this.log.debug("Fetching feed", ident, url)
      let req = request(url)
      req.setHeader('user-agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_8_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.63 Safari/537.36')
      req.setHeader('accept', 'text/html,application/xhtml+xml')
      req.on('error', reject)
      req.on('response', (res) => {
        if (res.statusCode != 200) return req.emit('error', new Error('Bad status code'))
        res.pipe(feedparser)
      })

    })
  }

  async _createParser(url, ident, resolve, reject) {
    let readTracking = this.config.enableReadTracking
    let feedparser = new FeedParser()
    feedparser.on('error', reject)
    let meta
    feedparser.on('end', async () => {
      this.log.debug("Finished parsing feed", ident, url)
      if (this.config.enableReadTracking) {
        await this.models['feedreader-feedread'].createOrUpdate({url}, {url, meta})
      }
      resolve()
    })

    let lastRead
    if (readTracking) {
      last = await this.models['feedreader-feedread'].findOne({url})
      if (last) {
        if (last.meta && last.meta.date) {
          lastRead = last.meta.date
        } else {
          lastRead = last.updatedAt
        }
      }
    }

    let skip = false
    feedparser.on('meta', (m) => {
      meta = m
      skip = lastRead && lastRead >= meta.date
      if (skip) {
        this.log.debug("Skipping", url, "last read on", lastRead, "now", meta.date)
      }
    })
    
    let _callOrQueue = ::this._callOrQueue
    feedparser.on('readable', function() {
      let item
      while (item = this.read()) {
        if (!readTracking || (!skip && item.date >= lastRead)) {
          _callOrQueue("processItem", {item, ident})
        }
      }
    })

    return feedparser

  }

  async _processItem({item, ident}) {
    let processors = [].concat(this._processors[null] || []).concat(this._processors[ident] || [])
    for (let p of processors) {
      await p(item, ident)
    }
  }
}

var feedreader = FeedReader.getProxy()
export {FeedReader as default, feedreader}

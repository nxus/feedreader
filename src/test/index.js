import FeedReader, {feedreader} from '../'

import fs from 'fs'
import sinon from 'sinon'


describe("FeedReader", function() {

  describe("Sanity", () => {
    it("should be defined", () => {
      FeedReader.should.not.be.null
      feedreader.should.not.be.null
    })
  })

  describe("Parse a feed", () => {
    let fr, items = []
    before(async function(done) {
      
      let stream = fs.createReadStream(__dirname+"/news.xml")

      fr = new FeedReader()
      fr.config.enableReadTracking = false
      fr._feeds['test'] = {ident: 'test', url: 'http://example.com'}
      fr._processors['test'] = [(i, id) => {
        items.push(i)
      }]
      let parser = await fr._createParser('local-path', 'test', done, (err) => {
        console.log("Err", err)
        done(err)
      })
      stream.pipe(parser)
    })
    it("got results", () => {
      items.should.have.property('length', 20)
      items[0].meta.should.have.property('description', 'Google News')
    })
  })
  describe("Get a real feed", () => {
    let fr, items = []
    before(async () => {
      
      fr = new FeedReader()
      fr.config.enableReadTracking = false
      fr._feeds['test'] = {ident: 'test', url: 'https://news.google.com/news/rss/'}
      fr._processors['test'] = [(i, id) => {
        items.push(i)
      }]
      await fr._fetch({ident:'test'})
      return
    })
    it("got results", () => {
      items.should.have.property('length', 20)
      items[0].meta.should.have.property('description', 'Google News')
    })
  })
  
})

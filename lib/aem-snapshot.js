/**
 * Efficient AEM data loader
 * @author Ben Soicher
 */

(function (root, $, async) {

  var re = {
    // Node path format
    norm: /(^|\/)(en|fr)($|\/[^\.?]*)/,
  }

  // Options formatters
  var opts = {
    root: function (url) {
      return { url: aem.domain + aem.normalize(url) + '.sitemap.xml', dataType: 'xml json' }
    },
    meta: function (url) {
      return { url: aem.domain + aem.normalize(url) + '/jcr:content.json', timeout: 5000 }
    },
    assetMeta: function (url) {
      return { url: aem.domain + url.replace(/^\//, '') + '/jcr:content.json', cache: false }
    },
    html: function (url) {
      return { url: aem.domain + aem.normalize(url) + '.html', dataType: 'text json', timeout: 10000 }
    }
  }

  // DataType conversion
  var converters = {

    'xml json': function (xml) {
      return $('url', xml).map(function () {
        return {
          path: aem.normalize(this.firstChild.textContent),
          lastmod: Date.parse(this.lastChild.textContent) / 1000,
        }
      }).get().reverse()
    },

    'text json': function (text) {

      if (/^<!doctype html>/.exec(text)) {
        text = text.replace(/\s{2,}/g, ' ')

        if (typeof aem.filterHtml === 'function') {
          return { html: aem.filterHtml(text) }
        } else {
          return { html: text }
        }
      }
  
      var json = JSON.parse(text)

      if (json.gcGuid) {
        // Fix/remove some values
        Object.keys(json).forEach(function(key) {
          if (key.includes('@TypeHint')) {
            delete json[key]
          } else if (json[key] === 'true') {
            json[key] = true
          } else if (json[key] === 'false') {
            json[key] = false
          } else if (typeof json[key] === 'string') {
            json[key] = json[key].trim()
          }
        })

        json.peer = aem.normalize(json.gcAltLanguagePeer)
      }

      return json
    },

  }

  // Create a queue to send requests
  var q = async.queue(function (opts, cb) {

    // Additional request options
    Object.assign(opts, {
      cache: false,
      converters: converters,
      success: function (data) {
        if (data.gcGuid || data.html) {
          data.path = aem.normalize(opts.url)
        } else if (aem.preFilter && Array.isArray(data)) {
          data = data.filter(aem.preFilter)
        }
        aem._save(data)
      },
      complete: function () {
        q.completed++
        cb(null)
      }
    })

    $.get(opts)
  }, 4)

  // Set initial completed count
  q.completed = 0

  var aem = root.aem = {

    // AEM domain
    domain: 'https://www.canada.ca/',

    limit: -1,

    // Format text using placeholders
    format: function (text, reverse) {
      if (aem.placeholders && typeof text === 'string') {
        if (!reverse) {
          text = text.replace(/{\w+}/g, function (key) {
            return aem.placeholders[key] || key;
          })
        } else {
          for (key in aem.placeholders) {
            text = text.replace(new RegExp(aem.placeholders[key], 'g'), key)
          }
        }
      }
      return text
    },

    // Format URL as node path
    normalize: function (url) {
      url = aem.format(url)

      try {
        return url.split('/jcr:content')[0].match(re.norm)[0].replace(/(^\/|\/$)/g, '')
      } catch (e) {
        throw new Error('Failed to parse node path from "' + url + '"')
      }
    },

    // Stores node data
    data: {},

    // Add/extend node data
    _save: function (data) {
      if (typeof data !== 'object') {
        throw new Error('aem._save expected object as input')
      }

      if (Array.isArray(data)) {
        data.forEach(aem._save)
      } else if (aem.data[data.path]) {
        Object.assign(aem.data[data.path], data)
      } else if (data) {
        aem.data[data.path] = data
      }
    },

    // Get path list
    nodes: function () {
      return Object.keys(aem.data)
    },

    // Get node count
    length: function () {
      return Object.keys(aem.data).length
    },

    // Update/Remove nodes
    each: function (fn) {
      aem.nodes().forEach(function (path) {
        if (fn(aem.data[path]) === false) {
          delete aem.data[path]
        }
      })
      return aem
    },

    // Queue sitemap request(s)
    addRoot: function (url) {
      q.push(Array.isArray(url) ? url.map(opts.root) : opts.root(url))
      return aem
    },

    // Queue metadata request(s)
    meta: function (url) {
      if (aem.limit != -1 && q.completed > aem.limit) {
        return aem
      }
      q.push(Array.isArray(url) ? url.map(opts.meta) : opts.meta(url))
      return aem
    },
    
    // Queue html request(s)
    html: function (url) {
      if (aem.limit != -1 && q.completed > aem.limit) {
        return aem
      }
      q.push(Array.isArray(url) ? url.map(opts.html) : opts.html(url))
      return aem
    },

    // Request asset metadata
    assetMeta: function (url) {
      return $.get(opts.assetMeta(url))
    },

    // Get progress bar values
    progress: function () {
      var total = q.completed + q.length() + q.running()
      return {
        complete: (total === 0 ? 0 : q.completed / total * 100) + '%',
        active: (total === 0 ? 0 : q.running() / total * 100) + '%'
      }
    },

    // Passthrough queue functions
    wait: q.drain,
    idle: q.idle,

  }

}(this, jQuery, async))

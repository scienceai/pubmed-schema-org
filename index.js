var url = require('url')
  , request = require('request')
  , clone = require('clone')
  , pubmed = require('./lib/pubmed').pubmed
  , oapmc = require('./lib/oapmc').oapmc
  , jats = require('./lib/jats');

/**
 * 'this' is an Ldpm instance
 */
function convert(id, opts, callback){

  if(arguments.length === 2){
    callback = opts;
    opts = {};
  }
  opts = clone(opts);

  var uri = "http://www.pubmedcentral.nih.gov/utils/idconv/v1.0/?ids=" + id + '&format=json';
  this.log('GET', uri);
  request(uri,function(error, response, body){
    if(error) return callback(error);
    this.log(response.statusCode, uri);

    if(response.statusCode >= 400){
      var err = new Error(body);
      err.code = response.statusCode;
      return callback(err);
    }

    //if error pubmedcentral display a webpage with 200 return code :( so we are cautious...
    try{
      body = JSON.parse(body);
    } catch(e){
      return callback(new Error(url.parse(uri).hostname + ' did not returned valid JSON'));
    }

    if(body.records && body.records.length){
      opts.pmcid = body.records[0].pmcid;
      opts.pmid = body.records[0].pmid;
      opts.doi = body.records[0].doi;

      if (opts.pmcid){
        oapmc.call(this, opts.pmcid, opts, function(err, pkg, html){//passing a pmid (if not undefined => add pubmed annotation)
          if (err && opts.pmid) {
            this.emit('log', 'ldpm-pubmed'.grey +  ' ERR! '.red + err.message + (('code' in err) ? ' (' + err.code + ')': ''));
            pubmed.call(this, opts.pmid, opts, callback);
          } else {
            callback(err, pkg, html);
          }
        }.bind(this));
      } else if(opts.pmid){
        pubmed.call(this, opts.pmid, opts, callback);
      } else {
        callback(new Error('the id cannot be recognized'));
      }
    } else {
      callback(new Error('the id cannot be recognized'));
    }
  }.bind(this));

};

exports.convert = convert;
exports.jats = jats;

var request = require('request')
  , util = require('util')
  , fs = require('fs')
  , url = require('url')
  , async = require('async')
  , path = require('path')
  , temp = require('temp')
  , tar = require('tar')
  , zlib = require('zlib')
  , once = require('once')
  , pubmed = require('./pubmed').pubmed
  , Client = require('ftp')
  , DecompressZip = require('decompress-zip')
  , recursiveReaddir = require('recursive-readdir')
  , isUrl = require('is-url')
  , DOMParser = require('xmldom').DOMParser
  , XMLSerializer = require('xmldom').XMLSerializer
  , _ = require('underscore')
  , clone = require('clone')
  , mime = require('mime')
  , pubmed = require('./pubmed').pubmed
  , Jats2Html = require('./jats2html')
  , jats = require('./jats')
  , beautifyHtml = require('js-beautify').html
  , gm = require('gm')
  , tools = require('./tools');

temp.track();

exports.oapmc = oapmc;
exports._fetchTargz = _fetchTargz;
exports._pkg = _pkg;
exports._html = _html;

/**
 * 'this' is an Ldpm instance
 * opts: pmid: -> add pubmed annotation
 */
function oapmc(pmcid, opts, callback){

  if(arguments.length === 2){
    callback = opts;
    opts = {};
  }

  var that = this;

  _fetchTargz(pmcid, that, function(err, root){
    if(err) return callback(err);
    _pkg(pmcid, that, root, opts, callback);    
  });

};


/**
 * see http://www.ncbi.nlm.nih.gov/pmc/tools/ftp/
 * return the list of files contained in the tar.gz of the article,
 * and move the relevant one (i.e non inline formula or co) into the current directory
 */
function _fetchTargz(pmcid, ldpm, callback){

  callback = once(callback);

  // Fetch XML doc containing URI of the tar.gz of the article
  var uri = 'http://www.pubmedcentral.nih.gov/utils/oa/oa.fcgi?id=' + pmcid;
  ldpm.logHttp('GET', uri);
  request(uri, function(error, response, oaContentBody){ 
    if(error) return callback(error);
    ldpm.logHttp(response.statusCode, uri);

    if(response.statusCode >= 400){
      var err = new Error(oaContentBody);
      err.code = response.statusCode;
      return callback(err);
    }

    //get URI of the tarball
    var doc = new DOMParser().parseFromString(oaContentBody, 'text/xml');
    var $links = doc.getElementsByTagName('link');

    try {
      var $linkTgz = Array.prototype.filter.call($links, function(x){return x.getAttribute('format') === 'tgz';})[0];
      var tgzUri = $linkTgz.getAttribute('href');
    } catch(e) {
      return callback(new Error('could not get tar.gz URI'));
    }

    temp.mkdir('__ldpmTmp', function(err, root) {
      if (err) return callback(err);

      var puri = url.parse(tgzUri);

      var c = new Client(); 
      c.connect({ host: puri.host });

      ldpm.logHttp('GET', tgzUri, 'ftp');
      c.on('ready', function() {
        c.get(puri.path, function(err, stream) {
          if (err) return callback(err);
          ldpm.logHttp(200, tgzUri, 'ftp');

          var s = stream
            .pipe(zlib.Unzip())
            .pipe(tar.Extract({ path: root, strip: 1 }));

          s.on('error', callback);        
          s.on('end', function() {
            c.end();
            callback(null, root);
          });

        });
      });
    });
    
  });

};



function _pkg(pmcid, ldpm, root, opts, callback){

  if(arguments.length === 4){
    callback = opts;
    opts = {};
  }

  readTargzFiles(root, function(err, xml, files, mainArticleName, license){
    if(err) return callback(err);

    try {
      var $doc = new DOMParser().parseFromString(xml, 'text/xml');
    }  catch(err){
      return callback(err);
    }

    var $article = $doc.getElementsByTagName('article')[0];
    var inlines = jats.inlines($article);

    files2resources(ldpm, root, files, inlines, mainArticleName, function(err, resources){
      if(err) return callback(err);
      
      try {
        var pkg = article2pkg($article, resources, mainArticleName, license, pmcid, opts.pmid, opts.doi);
      } catch(err){
        return callback(err);
      }        

      if(opts.pmid){
        addPubmedAnnotations(pkg, ldpm, opts.pmid, opts, function(err, pkg){
          if(err) return callback(err);
          return callback(null, pkg, files, inlines, $doc)          
        });
      } else {
        callback(null, pkg, files, inlines, $doc);
      }

    });

  });
};


function _html(pkg, files, inlines, $doc, callback){

  _inline2imgBase64(files, inlines, function(err, ctx){
    if(err) return callback(err);
    
    var p = new Jats2Html(ctx, pkg);
    var html = p.parse($doc.getElementsByTagName('article')[0]);

    callback(null, beautifyHtml(html, {indent_size: 2}));
  });

};


function addPubmedAnnotations(pkg, ldpm, pmid, opts, callback){
  if(arguments.length === 3){
    callback = opts;
    opts = {};
  }

  pubmed.call(ldpm, pmid, opts, function(err, pubmedPkg){
    if(err) return callback(err);

    if(pubmedPkg.annotation){
      pkg.annotation = pubmedPkg.annotation;
    }

    if(pubmedPkg.dataset){
      pkg.dataset = (pkg.dataset || []).concat(pubmedPkg.dataset);
    }

    callback(null, pkg);
  });
};


function readTargzFiles(root, callback){

  recursiveReaddir(root, function (err, files) {              
    if (err) return callback(err);

    //locate nxml file
    var nxml;
    for(var i=0; i<files.length; i++){
      if(path.extname(path.basename(files[i])) === '.nxml'){
        nxml = files[i];
        break;
      }
    }
    
    if(!nxml){
      return callback(new Error('tar.gz does not contain .nxml file'));
    }

    //get the name of the main article: from the name of  nxml file
    var mainArticleName = path.basename(nxml, path.extname(nxml)).replace(/ /g, '-');

    fs.readFile(nxml, {encoding: 'utf8'}, function(err, xml){
      if(err) return callback(err);

      var filteredFiles = files.filter(function(x){ return path.basename(x) !== 'license.txt' && path.extname(x) !== '.nxml' ;});              
      var licensePath = files.filter(function(x){ return path.basename(x) === 'license.txt';})[0];

      if(licensePath){
        fs.readFile(licensePath, {encoding: 'utf8'}, function(err, license){
          callback(null, xml, filteredFiles, mainArticleName, tools.cleanText(license));   
        });
      } else {
        callback(null, xml, filteredFiles, mainArticleName);
      }      
      
    });
  });

};


function files2resources(ldpm, root, files, inlines, mainArticleName, callback){  

  var compressedBundles = files.filter(function(file){
    return !! (['.gz', '.gzip', '.tgz','.zip'].indexOf(path.extname(file))>-1);
  });
 
  inlines = inlines || [];
  files = _.difference(files, compressedBundles, inlines);

  //some inline ref have no extension: take care of that...
  files = files.filter(function(file){
    var name = path.basename(file);
    var name2 = path.basename(file, path.extname(file));
    return !! ((inlines.indexOf(name) === -1) && (inlines.indexOf(name2) === -1));
  });
  
  //uncompress bundles so that we can check if truely a code bundle or a compression of a single media file.
  var codeBundles = [];
  
  async.eachSeries(compressedBundles, function(f, cb){
    cb = once(cb);
    var uncompressedDir = path.join(path.dirname(f), path.basename(f, path.extname(f)));
    
    function _next (){
      recursiveReaddir(uncompressedDir, function(err, newFiles){
        if(err) return cb(err);
        
        if(newFiles.length === 1) {

          var recognisedFormat = ['.avi', '.mpeg', '.mov','.wmv', '.mpg', '.mp4'].concat(
            ['.wav', '.mp3', '.aif', '.aiff', '.aifc', '.m4a', '.wma', '.aac'],
            ['.r', '.py', '.m','.pl'],
            ['.pdf', '.odt', '.doc', '.docx', '.html'],
            ['.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff', '.eps', '.ppt', '.pptx'],
            ['.csv', '.tsv', '.xls', '.xlsx', '.ods', '.json', '.jsonld', '.ldjson', '.txt', '.xml', '.nxml', '.ttl', '.rtf']
          );

          if(recognisedFormat.indexOf(path.extname(newFiles[0])) > -1){ //recognized
            files.push(newFiles[0]);
          } else {
            codeBundles.push(uncompressedDir);
          }

        } else {
          codeBundles.push(uncompressedDir);          
        }

        cb(null);
        
      });
    };

    var s;
    if(path.extname(f) === '.zip'){

      var unzipper = new DecompressZip(f);
      unzipper.on('error', cb);
      unzipper.on('extract', _next);
      unzipper.extract({ path: uncompressedDir });

    } else {

      s = fs.createReadStream(f);
      s = s.pipe(zlib.Unzip()).pipe(tar.Extract({ path: uncompressedDir }));
      s.on('error',  cb);
      s.on('end', _next);

    }

  }, function(err){

    if(err) return callback(err);

    function _newPath(p){
      return path.join(ldpm.root, path.relative(root, p));
    };

    //mv files and dir to ldpm.root
    var toMv = files.concat(codeBundles);
    async.each(toMv, function(p, cb){
      fs.rename(p, _newPath(p), cb);
    }, function(err){
      if(err) return callback(err);      
      

      ldpm.paths2resources(files.map(_newPath), { codeBundles: codeBundles.map(_newPath) }, callback);
    });
    
  });
    
};


/*
 * depreciated: use the .nxml contained in the tar.gz instead
 */
function fetchXml(pmcid, ldpm, callback){
  var uri = 'http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:' + pmcid.slice(3) + '&metadataPrefix=pmc';

  ldpm.logHttp('GET', uri);
  request(uri, function(error, resp, xml){
    if(error) return callback(error);

    ldpm.logHttp(resp.statusCode, uri);

    if(resp.statusCode >= 400){
      var err = new Error(xml);
      err.code = resp.statusCode;
      return callback(err);
    }

    callback(null, xml);
  });
};

/**
 * idealy name pkg with (journal-)lastname-year
 */
function _pkgName(journal, author, datePublished, pmcid){

  var pkgName = [];

  var journalShortName = (journal.alternateName || journal.name).split(' ').map(function(x){return x.trim().replace(/\W/g, '').toLowerCase();}).join('-');

  if(journalShortName){
    pkgName.push(journalShortName);
  }

  if(author && author.familyName){
    pkgName.push(tools.removeDiacritics(author.familyName.toLowerCase()).replace(/\W/g, ''));
  }

  if(datePublished){
    pkgName.push((new Date(datePublished)).getFullYear());
  }

  if(pkgName.length>=2){
    return pkgName.join('-');
  } else {
    return pmcid;
  }

};


function article2pkg($article, resources, mainArticleName, license, pmcid, pmid, doi){

  var $articleMeta = $article.getElementsByTagName('article-meta')[0];
  var $journalMeta = $article.getElementsByTagName('journal-meta')[0];

  var journal = jats.journal($journalMeta);
  var allContributors = jats.allContributors($articleMeta);
  var datePublished = jats.datePublished($articleMeta);
  var headline = jats.headline($articleMeta);

  var pkg = {};

  pkg.name = _pkgName(journal, allContributors.author, datePublished, pmcid);

  pkg.version = '0.0.0';

  var keywords = jats.keywords($article);
  if(keywords && keywords.length){
    pkg.keywords = keywords;
  }

  if(datePublished){
    pkg.datePublished = datePublished;
  }

  if(headline){
    pkg.description = headline;
  }

  var mylicense = jats.license($articleMeta);

  if(mylicense){
    pkg.license = mylicense;
  } else if(license){
    pkg.license = { text: license };
  }

  if(allContributors.author){
    pkg.author = allContributors.author;
  }

  if(allContributors.contributor){
    pkg.contributor =  allContributors.contributor;
  }

  pkg.provider = {
    '@type': 'Organization',
    '@id': 'http://www.ncbi.nlm.nih.gov/pmc/',
    description: 'From PMC®, a database of the U.S. National Library of Medicine.'
  };

  var sourceOrganization = jats.sourceOrganization($article);
  if(sourceOrganization){
    pkg.sourceOrganization = sourceOrganization;
  }

  pkg.accountablePerson = {
    '@type': 'Organization',
    name: 'Standard Analytics IO',
    email: 'contact@standardanalytics.io'
  };

  var copyrightYear = jats.copyrightYear($articleMeta);
  if( copyrightYear ){
    pkg.copyrightYear = copyrightYear;
  }

  var copyrightHolder = jats.copyrightHolder($articleMeta);
  if( copyrightHolder ){
    pkg.copyrightHolder = copyrightHolder;
  }

  //resources
  resources = jats.resources($article, resources);
  
  Object.keys(resources).forEach(function(type){
    pkg[type] = resources[type];
  });

  var mainArticle = (pkg.article || []).filter(function(x){ return x.name === mainArticleName;})[0];

  if(mainArticle){
    mainArticle['@type'] = 'ScholarlyArticle';

    var publisher = jats.publisher($journalMeta);
    if(publisher){
      mainArticle.publisher = publisher;
    }

    if(allContributors.editor){
      mainArticle.editor = allContributors.editor;
    }

    if(allContributors.accountablePerson){
      mainArticle.accountablePerson = allContributors.accountablePerson;
    }

    if(journal){
      mainArticle.journal = journal;
    }

    var ids = jats.ids($articleMeta) || {};
    if(!ids.pmcid && pmcid){
      ids.pmcid = pmcid;
    }
    if(!ids.pmid && pmid){
      ids.pmid = pmid;
    }
    if(!ids.doi && doi){
      ids.doi = doi;
    }

    if(ids.doi){
      mainArticle.doi = ids.doi;
    }

    if(ids.pmid){
      mainArticle.pmid = ids.pmid;
    }

    if(ids.pmcid){
      mainArticle.pmcid = ids.pmcid;
    }

    if(headline){
      mainArticle.headline = headline;
    }

    var alternativeHeadline = jats.alternativeHeadline($articleMeta);
    if(alternativeHeadline){
      mainArticle.alternativeHeadline = alternativeHeadline;
    }      

    var about = jats.about($articleMeta);
    if (about){
      mainArticle.about = about;
    }

    var issue = jats.issue($articleMeta);
    if(issue !== undefined){
      mainArticle.issue = issue;
    }

    var volume = jats.volume($articleMeta);
    if(volume !== undefined){
      mainArticle.volume = volume;
    }

    var pageStart = jats.pageStart($articleMeta);
    if(pageStart !== undefined){
      mainArticle.pageStart = pageStart;
    }

    var pageEnd = jats.pageStart($articleMeta);
    if(pageEnd !== undefined){
      mainArticle.pageEnd = pageEnd;
    }

    var citations = jats.citations($article);
    if(citations){
      mainArticle.citation = citations;
    }

  }

  return pkg;
};


function _inline2imgBase64(files, inlines, callback){

  if(!files || !inlines){
    return callback(null, {});
  }

  var basenames = files.map(function(x){return path.basename(x);});

  //some href have no extensions, take care of that.
  var allExts = _.uniq(files
                       .map(function(x){ return path.extname(x); })
                       .filter(function(x) { return !!x; }));
  allExts.push(''); //if no extensions

  var src = {}; //hash href : img.src as base 64
  
  async.eachLimit(inlines, 8, function(href, cb){ //use eachLimit to avoid EMFILE error if too many files are opened by graphics magic

    //reconstruct all possible extension (including '') and prioritize .gif
    var mpath;
    for(var i = 0; i< allExts.length; i++){
      var ind = basenames.indexOf(href + allExts[i]);
      if(ind > -1){
        mpath = files[ind];
        if(allExts[i] === '.gif'){
          break;
        }
      }
    }
    if(!mpath){
      return cb(new Error('could not find file for inline element ' + href));
    }
    
    //recrop img to avoid hugle blanks like http://www.ncbi.nlm.nih.gov/pmc/articles/PMC2958805/
    gm(mpath)
      .trim()
      .toBuffer(function (err, buffer) {
        if(err) return cb(err);
        src[href] = "data:" + mime.lookup(path.extname(mpath)) + ";base64," + buffer.toString('base64');
        cb(null);
      });

  }, function(err){    
    callback(err, src);
  });

};

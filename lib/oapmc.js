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
  , gm = require('gm')
  , Packager = require('package-jsonld')
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

  if (arguments.length === 2){
    callback = opts;
    opts = {};
  }

  var that = this;

  _fetchTargz(pmcid, that, function(err, rootTargz){
    if (err) return callback(err);
    _pkg(pmcid, that, rootTargz, opts, function(err, pkg, root, files, inlines, $doc){
      if (err) return callback(err);
      if (opts.html) {
        _html(pkg, root, files, inlines, $doc, function(err, pkg, html){
          fs.writeFile(path.join(root, 'JSONLD'), JSON.stringify(pkg, null, 2), function(err){
            callback(err, pkg, html);
          });
        });
      } else {
        fs.writeFile(path.join(root, 'JSONLD'), JSON.stringify(pkg, null, 2), function(err){
          callback(err, pkg);
        });
      }
    });
  });

};


/**
 * see http://www.ncbi.nlm.nih.gov/pmc/tools/ftp/
 */
function _fetchTargz(pmcid, ldpm, callback){

  callback = once(callback);

  // Fetch XML doc containing URI of the tar.gz of the article
  var uri = 'http://www.pubmedcentral.nih.gov/utils/oa/oa.fcgi?id=' + pmcid;
  ldpm.log('GET', uri);
  request(uri, function(error, response, oaContentBody){
    if (error) return callback(error);
    ldpm.log(response.statusCode, uri);

    if (response.statusCode >= 400){
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

    temp.mkdir('__ldpmTmp', function(err, rootTargz) {
      if (err) return callback(err);

      var puri = url.parse(tgzUri);

      var c = new Client();
      c.connect({ host: puri.host });

      ldpm.log('GET', tgzUri, 'ftp');
      c.on('ready', function() {
        c.get(puri.path, function(err, stream) {
          if (err) return callback(err);
          ldpm.log(200, tgzUri, 'ftp');

          var s = stream
            .pipe(zlib.Unzip())
            .pipe(tar.Extract({ path: rootTargz, strip: 1 }));

          s.on('error', callback);
          s.on('end', function() {
            c.end();
            callback(null, rootTargz);
          });

        });
      });
    });

  });

};


function _pkg(pmcid, ldpm, rootTargz, opts, callback){

  if (arguments.length === 4) {
    callback = opts;
    opts = {};
  }

  _readTargzFiles(rootTargz, function(err, xml, files, mainArticleName, license){
    if (err) return callback(err);

    try {
      var $doc = new DOMParser().parseFromString(xml, 'text/xml');
    }  catch(err){
      return callback(err);
    }

    var $article = $doc.getElementsByTagName('article')[0];
    var inlines = jats.inlines($article);

    _files2resources(ldpm, rootTargz, files, inlines, mainArticleName, function(err, resources){
      if (err) return callback(err);

      try {
        var pkg = _article2pkg($article, resources, mainArticleName, license, pmcid, opts.pmid, opts.doi);
      } catch(err){
        return callback(err);
      }

      //save contentData to disk and delete it as not supported by schema.org
      var dnode = [];
      (pkg.hasPart || []).forEach(function(x){
        if (!x.distribution) return;
        var dist = Array.isArray(x.distribution) ? x.distribution: [x.distribution];
        dist.forEach(function(y){
          if (y.contentData) {
            dnode.push(y);
          }
        });
      });

      var tableIndex = 0;
      async.each(dnode, function(d, cb){
        var uid = 'table';
        while (~files.map(path.basename).indexOf(uid + '.html')) { uid = 'table-' + tableIndex++; }
        d.filePath = uid + '.html';
        var absPath = path.join(ldpm.root, d.filePath);
        files.push(absPath);
        var data = d.contentData;
        delete d.contentData;
        fs.writeFile(absPath, data, cb);
      }, function(err){
        if (err) return callback(err);

        if (opts.pmid){
          _addPubmedAnnotations(pkg, ldpm, opts.pmid, mainArticleName, opts, function(err, pkg){
            if (err) return callback(err);
            return callback(null, pkg, ldpm.root, files, inlines, $doc)
          });
        } else {
          callback(null, pkg, ldpm.root, files, inlines, $doc);
        }

      });

    });

  });

};

function _html(pkg, root, files, inlines, $doc, callback){

  _inline2imgBase64(pkg, root, files, inlines, function(err, ctx){
    if (err) return callback(err);

    var p = new Jats2Html(pkg, ctx);
    var html = p.parse($doc.getElementsByTagName('article')[0]);

    var i = 0, uid = 'article';
    while (~files.map(path.basename).indexOf(uid + '.html')) { uid = 'article-' + i++; }
    var filePath = uid + '.html';
    var absPath = path.join(root, filePath);
    var encoding = {
      '@type': 'MediaObject',
      dateModified: (new Date()).toISOString(),
      encodingFormat: 'text/html',
      filePath: filePath
    };
    if (!pkg.encoding) {
      pkg.encoding = encoding
    } else if (Array.isArray(pkg.encoding)) {
      pkg.encoding.push(encoding)
    } else {
      pkg.encoding = [pkg.encoding, encoding];
    }

    fs.writeFile(absPath, html, function(err){
      callback(err, pkg, html);
    });
  });

};

function _addPubmedAnnotations(pkg, ldpm, pmid, mainArticleName, opts, callback){
  if (arguments.length === 4){
    callback = opts;
    opts = {};
  }

  pubmed.call(ldpm, pmid, opts, function(err, pubmedPkg){
    if (err) return callback(err);

    if (pubmedPkg.article && pubmedPkg.article[0].about){
      var article = pkg.article.filter(function(x){return x.name === mainArticleName;})[0];
      if (article){
        article.about = pubmedPkg.article[0].about;
      }
    }

    if (pubmedPkg.dataset){
      pkg.dataset = (pkg.dataset || []).concat(pubmedPkg.dataset);
    }

    callback(null, pkg);
  });
};


function _readTargzFiles(rootTargz, callback){

  recursiveReaddir(rootTargz, function (err, files) {
    if (err) return callback(err);

    //locate nxml file
    var nxml;
    for (var i=0; i<files.length; i++){
      if (path.extname(path.basename(files[i])) === '.nxml'){
        nxml = files[i];
        break;
      }
    }

    if (!nxml){
      return callback(new Error('tar.gz does not contain .nxml file'));
    }

    //get the name of the main article: from the name of  nxml file
    var mainArticleName = path.basename(nxml, path.extname(nxml)).replace(/ /g, '-');

    fs.readFile(nxml, {encoding: 'utf8'}, function(err, xml){
      if (err) return callback(err);

      var filteredFiles = files.filter(function(x){ return path.basename(x) !== 'license.txt' && path.extname(x) !== '.nxml' ;});
      var licensePath = files.filter(function(x){ return path.basename(x) === 'license.txt';})[0];

      if (licensePath){
        fs.readFile(licensePath, {encoding: 'utf8'}, function(err, license){
          callback(null, xml, filteredFiles, mainArticleName, tools.cleanText(license));
        });
      } else {
        callback(null, xml, filteredFiles, mainArticleName);
      }

    });
  });

};


function _files2resources(ldpm, rootTargz, files, inlines, mainArticleName, callback){

  var compressedFiles = files.filter(function(file){
    return !! (['.gz', '.gzip', '.tgz','.zip'].indexOf(path.extname(file))>-1);
  });

  inlines = inlines || [];
  files = _.difference(files, compressedFiles, inlines);

  //some inline ref have no extension: take care of that...
  files = files.filter(function(file){
    var name = path.basename(file);
    var name2 = path.basename(file, path.extname(file));
    return !! ((inlines.indexOf(name) === -1) && (inlines.indexOf(name2) === -1));
  });

  //uncompress compressedFiles so that we can check if it is truly a compressed directory (or group of files) or a compression of a single media file.
  var dirs = []; //true directories

  async.eachSeries(compressedFiles, function(f, cb){
    cb = once(cb);
    var uncompressedDir = path.join(path.dirname(f), path.basename(f, path.extname(f)));

    var s;
    if (path.extname(f) === '.zip'){
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

    function _next (){
      recursiveReaddir(uncompressedDir, function(err, newFiles){
        if (err) return cb(err);
        if (newFiles.length === 1) {
          files.push(newFiles[0]);
        } else {
          dirs.push(uncompressedDir);
        }
        cb(null);
      });
    };

  }, function(err){
    if (err) return callback(err);

    //mv files and dir to ldpm.root
    function _newPath(p){
      return path.join(ldpm.root, path.relative(rootTargz, p));
    };

    async.each(files.concat(dirs), function(p, cb){
      fs.rename(p, _newPath(p), cb);
    }, function(err){
      if (err) return callback(err);
      ldpm.wrap((files.concat(dirs)).map(_newPath), callback);
    });

  });

};


/*
 * depreciated: use the .nxml contained in the tar.gz instead
 */
function fetchXml(pmcid, ldpm, callback){
  var uri = 'http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:' + pmcid.slice(3) + '&metadataPrefix=pmc';

  ldpm.log('GET', uri);
  request(uri, function(error, resp, xml){
    if (error) return callback(error);

    ldpm.log(resp.statusCode, uri);

    if (resp.statusCode >= 400){
      var err = new Error(xml);
      err.code = resp.statusCode;
      return callback(err);
    }

    callback(null, xml);
  });
};

/**
 * idealy name pkg with (periodical-)lastname-year
 */
function _pkgId(periodical, author, datePublished, pmcid){

  var pkgName = [];

  var periodicalShortName = (periodical.alternateName || periodical.name).split(' ').map(function(x){return x.trim().replace(/\W/g, '').toLowerCase();}).join('-');

  if (periodicalShortName){
    pkgName.push(periodicalShortName);
  }

  if (author && author.familyName){
    pkgName.push(tools.removeDiacritics(author.familyName.toLowerCase()).replace(/\W/g, ''));
  }

  if (datePublished){
    pkgName.push((new Date(datePublished)).getFullYear());
  }

  if (pkgName.length>=2){
    return pkgName.join('-');
  } else {
    return pmcid;
  }

};


function _article2pkg($article, resources, mainArticleName, license, pmcid, pmid, doi){

  var $articleMeta = $article.getElementsByTagName('article-meta')[0];
  var $journalMeta = $article.getElementsByTagName('journal-meta')[0];

  var periodical = jats.periodical($journalMeta);
  var allContributors = jats.allContributors($articleMeta);
  var datePublished = jats.datePublished($articleMeta);

  var pkg = {
    '@context': Packager.contextUrl,
    '@id': _pkgId(periodical, allContributors.author, datePublished, pmcid),
    '@type': 'MedicalScholarlyArticle',
    'version': '0.0.0',
  };

  var ids = jats.ids($articleMeta) || {};
  var sameAs = [];
  if (ids.doi || doi) { sameAs.push('http://doi.org/' + (ids.doi || doi) ); }
  if (ids.pmcid || pmcid) { sameAs.push('http://www.ncbi.nlm.nih.gov/pmc/articles/' + (ids.pmcid || pmcid) ); }
  if (ids.pmid || pmid) { sameAs.push('http://www.ncbi.nlm.nih.gov/pubmed/' + (ids.pmid || pmid) ); }
  if (sameAs.length) {
    pkg.sameAs = sameAs;
  }

  var keywords = jats.keywords($article);
  if (keywords && keywords.length) { pkg.keywords = keywords; }
  if (datePublished) { pkg.datePublished = datePublished; }

  var headline = jats.headline($articleMeta);
  if (headline) { pkg.headline = headline; }

  var alternativeHeadline = jats.alternativeHeadline($articleMeta);
  if (alternativeHeadline) { pkg.alternativeHeadline = alternativeHeadline; }

  var mylicense = jats.license($articleMeta);
  if (mylicense) {
    pkg.license = mylicense;
  } else  {
    pkg.license = 'http://www.ncbi.nlm.nih.gov/pmc/about/copyright/'; //NOTE; `license` (from license.txt in the tarball) is also available
  }

  if (allContributors.author){ pkg.author = allContributors.author; }
  if (allContributors.contributor){ pkg.contributor =  allContributors.contributor; }
  if (allContributors.editor) { pkg.editor = allContributors.editor; }
  if (allContributors.accountablePerson) { pkg.accountablePerson = allContributors.accountablePerson; }

  var publisher = jats.publisher($journalMeta);
  if (publisher) { pkg.publisher = publisher; }

  var myabstract = jats['abstract']($articleMeta);
  if (myabstract) { pkg['abstract'] = myabstract; }

  pkg.provider = {
    '@type': 'Organization',
    '@id': 'http://www.ncbi.nlm.nih.gov/pmc/',
    description: 'From PMC®, a database of the U.S. National Library of Medicine.'
  };

  var sourceOrganization = jats.sourceOrganization($article);
  if (sourceOrganization) { pkg.sourceOrganization = sourceOrganization; }

  var copyrightYear = jats.copyrightYear($articleMeta);
  if ( copyrightYear ) { pkg.copyrightYear = copyrightYear; }

  var copyrightHolder = jats.copyrightHolder($articleMeta);
  if ( copyrightHolder ) { pkg.copyrightHolder = copyrightHolder; }

  //issue, volume, periodical, all nested...
  var isPartOf;

  var publicationIssue = jats.publicationIssue($articleMeta);
  if (publicationIssue) {
    isPartOf = publicationIssue;
  }

  var publicationVolume = jats.publicationVolume($articleMeta);
  if (publicationVolume) {
    if (publicationIssue) {
      publicationIssue.isPartOf = publicationVolume;
    } else {
      isPartOf = publicationVolume;
    }
  }

  if (periodical) {
    if (publicationVolume) {
      publicationVolume.isPartOf = periodical;
    } else if (publicationIssue) {
      publicationIssue.isPartOf = periodical;
    } else {
      isPartOf = periodical;
    }
  }

  if (isPartOf) {
    pkg.isPartOf = isPartOf;
  }

  var pageStart = jats.pageStart($articleMeta);
  if (pageStart !== undefined) { pkg.pageStart = pageStart; }

  var pageEnd = jats.pageStart($articleMeta);
  if (pageEnd !== undefined) { pkg.pageEnd = pageEnd; }

  var citations = jats.citations($article);
  if (citations) { pkg.citation = citations; }

  var rmainArticle = (resources || []).filter(function(x){ return x['@id'] === mainArticleName;})[0];
  if (rmainArticle) { pkg.encoding = rmainArticle.encoding; }

  var hasPart = jats.hasPart($article, pkg['@id'], (resources || []).filter(function(x){ return x['@id'] !== mainArticleName;}));
  if (hasPart && hasPart.length) {
    pkg.hasPart = hasPart;
  }

  return pkg;
};


function _inline2imgBase64(pkg, root, files, inlines, callback){
  files = files || [];
  inlines = inlines || [];

  var ctx = {}; //hash href : img.src as base 64

  //1. get thumbnail { path:, href: } objects
  var thumbnailPaths = [];
  var parts = pkg.hasPart || [];
  parts = Array.isArray(parts) ? parts : [parts];
  parts.forEach(function(r){
    if (r.thumbnail) {
      var thumbs = Array.isArray(r.thumbnail) ? r.thumbnail : [r.thumbnail];
      thumbs.forEach(function(t){
        if (t.filePath) {
          thumbnailPaths.push({href: t.filePath, path: path.join(root, t.filePath)});
        } else if (t.encoding) {
          var encs = Array.isArray(t.encoding) ? t.encoding : [t.encoding];
          encs.forEach(function(e){
            if (e.filePath) {
              thumbnailPaths.push({href: e.filePath, path: path.join(root, e.filePath)});
            }
          });
        }
      });
    }
  });


  //2. get inline  { path:, href: } objects
  var inlinePaths = [];

  var basenames = files.map(function(x){ return path.basename(x); });

  //some href have no extensions, take care of that.
  var allExts = _.uniq(files
                       .map(function(x){ return path.extname(x); })
                       .filter(function(x) { return !!x; }));
  allExts.push(''); //if no extensions

  for (var i=0; i<inlines.length; i++){
    var href = inlines[i];

    //reconstruct all possible extension (including '') and prioritize .gif
    var mpath;
    for (var j = 0; j< allExts.length; j++){
      var ind = basenames.indexOf(href + allExts[j]);
      if (ind > -1){
        mpath = {
          href: href,
          path: files[ind]
        };
        if (allExts[j] === '.gif'){
          break;
        }
      }
    }
    if (mpath){
      inlinePaths.push(mpath);
    } else {
      return callback(new Error('could not find file for inline element ' + href));
    }
  }

  //3. get data uri and store them in ctx
  async.eachLimit(inlinePaths.concat(thumbnailPaths), 8, function(mpathObj, cb){ //use eachLimit to avoid EMFILE error if too many files are opened by graphics magic

    //recrop img to avoid hugle blanks like http://www.ncbi.nlm.nih.gov/pmc/articles/PMC2958805/
    gm(mpathObj.path)
      .trim()
      .toBuffer(function (err, buffer) {
        if (err) return cb(err);
        ctx[mpathObj.href] = "data:" + mime.lookup(path.extname(mpathObj.path)) + ";base64," + buffer.toString('base64');
        cb(null);
      });

  }, function(err){
    callback(err, ctx);
  });

};

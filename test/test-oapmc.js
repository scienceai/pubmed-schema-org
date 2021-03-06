var path = require('path')
  , util = require('util')
  , tar = require('tar')
  , zlib = require('zlib')
  , assert = require('assert')
  , fs = require('fs')
  , temp = require('temp')
  , Dcat = require('dcat')
  , DOMParser = require('xmldom').DOMParser
  , beautifyHtml = require('js-beautify').html
  , traverse = require('traverse')
  , oapmc = require('../lib/oapmc');

temp.track();

var root = path.join(path.dirname(__filename), 'fixtures', 'oapmc');

var conf = {
  protocol: 'http',
  port: 3000,
  hostname: 'localhost',
  strictSSL: false,
  sha:true,
  name: "user_a",
  email: "user@domain.com",
  password: "user_a"
};

function getPkg(pmcid, opts, callback){
  if(arguments.length === 2){
    callback = opts;
    opts = {};
  }

  temp.mkdir('__tests', function(err, dirPath) {
    if(err) throw err;
    var dcat = new Dcat(conf, dirPath);
    var tgzStream = fs.createReadStream(path.join(root, pmcid.toLowerCase() + '.tar.gz'))
      .pipe(zlib.Unzip())
      .pipe(tar.Extract({ path: dirPath, strip: 1 }));

    tgzStream.on('end', function() {
      oapmc._pkg(pmcid, dcat, dirPath, opts, function(err, pkg, root, files, inlines, $doc){
        if(err) return callback(err);
        traverse(pkg).forEach(function(x) { if (this.key === 'dateModified') this.remove(); });
        if (opts.html) {
          oapmc._html(pkg, root, files, inlines, $doc, callback);
        } else {
          callback(null, pkg);
        }
      });
    });
  });
};

describe('pubmed central', function(){

  this.timeout(4000);

  describe('metadata', function(){
    //http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:2924383&metadataPrefix=pmc
    it('should create a package.jsonld for a ms with a movie zipped and not treat it as a code bundle', function(done){
      getPkg('PMC2924383', function(err, pkg){
        if(err) throw err;
        //fs.writeFileSync(path.join(root, 'pmc2924383.json'), JSON.stringify(pkg, null, 2));
        fs.readFile(path.join(root, 'pmc2924383.json'), function(err, expected){
          if(err) throw err;
          assert.deepEqual(JSON.parse(JSON.stringify(pkg)), JSON.parse(expected)); //JSON.parse(JSON.stringify) so that NaN are taken into account...
          done();
        });
      });
    });

    //http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:2958805&metadataPrefix=pmc
    it('should create a package.jsonld for a ms with a lot of inline formulaes AND add pubmed annotation', function(done){
      getPkg('PMC2958805', {pmid: 2958805}, function(err, pkg){
        if(err) throw err;
        //fs.writeFileSync(path.join(root, 'pmc2958805.json'), JSON.stringify(pkg, null, 2));
        fs.readFile(path.join(root, 'pmc2958805.json'), function(err, expected){
          if(err) throw err;
          assert.deepEqual(JSON.parse(JSON.stringify(pkg)), JSON.parse(expected)); //JSON.parse(JSON.stringify) so that NaN are taken into account...
          done();
        });
      });
    });

    //http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:3532326&metadataPrefix=pmc
    it('should create a package.jsonld for a ms with a codeBundle and an HTML table with footnotes', function(done){
      getPkg('PMC3532326', function(err, pkg){
        if(err) throw err;
        //fs.writeFileSync(path.join(root, 'pmc3532326.json'), JSON.stringify(pkg, null, 2));
        fs.readFile(path.join(root, 'pmc3532326.json'), function(err, expected){
          if(err) throw err;
          assert.deepEqual(JSON.parse(JSON.stringify(pkg)), JSON.parse(expected)); //JSON.parse(JSON.stringify) so that NaN are taken into account...
          done();
        });
      });
    });
  });

  describe('html body', function(){
    it('should parse body', function(done){
      getPkg('PMC3532326', {html:true}, function(err, pkg, html){
        if(err) throw err;
        //look at http://rdfa.info/play/ to check the structure of the RDFa
        //fs.writeFileSync(path.join(root, 'pmc3532326.html'), beautifyHtml(html, {indent_size: 2}));
        fs.readFile(path.join(root, 'pmc3532326.html'), {encoding:'utf8'}, function(err, expected){
          if(err) throw err;
          assert.deepEqual(beautifyHtml(html, {indent_size: 2}), expected);
          done();
        });
      });
    });
  });

});

var tools = require('./tools')
  , path = require('path')
  , isUrl = require('is-url')
  , XMLSerializer = require('xmldom').XMLSerializer
  , clone = require('clone')
  , _ = require('underscore')
  , url = require('url');


/**
 * Cf. http://jats.nlm.nih.gov/archiving/tag-library/1.1d1/index.html
 */

exports.publisher = function($journalMeta){
  if(! $journalMeta) return;

  var publisher = { '@type': 'Organization' };

  var $publisherName = $journalMeta.getElementsByTagName('publisher-name')[0];
  if($publisherName){
    publisher.name = tools.cleanText($publisherName.textContent);
  }

  var $publisherLoc = $journalMeta.getElementsByTagName('publisher-loc')[0];
  if($publisherLoc){
    publisher.location = {
      '@type': 'PostalAddress',
      description: tools.cleanText($publisherLoc.textContent)
    }
  } 

  if(Object.keys(publisher).length>1){
    return publisher;
  }

};


exports.issn = function($issns){  
  var issn;
  for(var i=0; i<$issns.length; i++){ //epub if possible because digital age
    issn = tools.cleanText($issns[i].textContent);
    if($issns[i].getAttribute('pub-type') === 'epub'){
      return issn;
    }
  }
  return issn;
};



exports.periodical = function($journalMeta){
  if(! $journalMeta) return;

  var periodical = { '@type': 'Periodical' };

  var $journalTitle = $journalMeta.getElementsByTagName('journal-title')[0];
  if($journalTitle){
    periodical.name = tools.cleanText($journalTitle.textContent);
  }
  

  var $journalId = $journalMeta.getElementsByTagName('journal-id');
  for(i=0; i<$journalId.length; i++){
    var journalIdType = $journalId[i].getAttribute('journal-id-type');
    if(journalIdType === 'nlm-ta'){
      periodical.alternateName = tools.cleanText($journalId[i].textContent); 
      break;
    }
  }

  if(!periodical.alternateName){ //try again with <abbrev-journal-title>
    var $abbrevJournalTitle = $journalMeta.getElementsByTagName('abbrev-journal-title');
    if($abbrevJournalTitle && $abbrevJournalTitle.length){
      for(i=0; i<$abbrevJournalTitle.length; i++){
        var abbrevType = $abbrevJournalTitle[i].getAttribute('abbrev-type');
        if(abbrevType === 'nlm-ta'){
          periodical.alternateName = tools.cleanText($abbrevJournalTitle[i].textContent); 
          break;
        }
      }        
    }
  }

  var $issn = $journalMeta.getElementsByTagName('issn');
  if($issn){
    periodical.issn = exports.issn($issn);
  }

  if(Object.keys(periodical).length > 1){
    return periodical;
  }
};


exports.ids = function($articleMeta){
  if(! $articleMeta) return;

  var ids = {};

  var $articleId = $articleMeta.getElementsByTagName('article-id');
  if($articleId){
    Array.prototype.forEach.call($articleId, function($el){
      var t = $el.getAttribute('pub-id-type');
      if(t === 'doi'){
        ids.doi = $el.textContent;
      } else if (t === 'pmid'){
        ids.pmid = $el.textContent;
      } else if (t === 'pmcid'){
        ids.pmcid = $el.textContent;
      }
    });
  }

  if(Object.keys(ids).length){
    return ids;
  }

};

exports.keywords = function($article){
  if(! $article) return;

  var keywords = [];

  //keywords from <article-categories>
  var $articleMeta = $article.getElementsByTagName('article-meta')[0];
  if($articleMeta){
    var $articleCategories = $articleMeta.getElementsByTagName('article-categories')[0];
    if($articleCategories){
      var $subjects = $articleCategories.getElementsByTagName('subject');
      if($subjects && $subjects.length){
        keywords = keywords.concat(Array.prototype.map.call($subjects, function($s){
          return tools.cleanText($s.textContent);
        }));
      }
    }
  }

  //keywords from kw
  var $kws = $article.getElementsByTagName('kw');
  if($kws && $kws.length){
    keywords = keywords.concat(Array.prototype.map.call($kws, function($kw){
      return tools.cleanText($kw.textContent);
    }));    
  }
  
  if(keywords.length){  
    return _.uniq(keywords); 
  }

};


exports.affiliations = function($articleMeta){
  if(! $articleMeta) return;

  var affiliations = {}; // affiliations are generally defined independently of authors, with keys that the author spans point to.
  
  var $affs = $articleMeta.getElementsByTagName('aff');
  if($affs){

    Array.prototype.forEach.call($affs, function($aff){
      var id = $aff.getAttribute('id');
      if(!id) return;
      
      var affiliation = { '@type': 'Organization' };

      var desc = '';

      var $institution = $aff.getElementsByTagName('institution')[0];
      var $addrLine = $aff.getElementsByTagName('addr-line')[0];
      var $country = $aff.getElementsByTagName('country')[0];
      var $fax = $aff.getElementsByTagName('fax')[0];
      var $phone = $aff.getElementsByTagName('phone')[0];
      var $email = $aff.getElementsByTagName('email')[0];

      if($institution){
        affiliation.name = $institution.textContent;
        desc = affiliation.name + '. ';      
      }

      if($addrLine){
        desc += $addrLine.textContent + '. ';
      }

      if($country){
        affiliation.address = {
          '@type': 'PostalAddress',
          addressCountry: $country.textContent
        };
        desc += $country.textContent + '. ';
      }

      if($fax){
        affiliation.faxNumber = $fax.textContent;
      }

      if($phone){
        affiliation.telephone = $phone.textContent;
      }

      if($email){
        affiliation.email = $email.textContent;
      }

      if(!desc){
        desc = _getTextExcludingTagNames($aff, ['sup', 'label']);
      }
      if(desc){
        affiliation.description = tools.cleanText(desc);
      }

      if(affiliations[id]){
        affiliations[id].push(affiliation);
      } else {
        affiliations[id] = [affiliation];
      }

    }); 
  }

  if(Object.keys(affiliations).length){
    return affiliations;
  }
};

exports.emails = function ($articleMeta){
  if(! $articleMeta) return;

  var emails = {};
  var $authorNotes = $articleMeta.getElementsByTagName('author-notes');
  if($authorNotes){
    Array.prototype.forEach.call($authorNotes, function($el){
      var $corresp = $el.getElementsByTagName('corresp')[0];
      var id = $corresp.getAttribute('id');
      var $email = $corresp.getElementsByTagName('email')[0];

      if(id && $email){
        emails[id] = $email.textContent;
      }
    });
  }

  if(Object.keys(emails).length){
    return emails;
  }  
};

//TODO: refine (see) <collab>
exports.collab = function($collab){
  if(! $collab) return;

  return {
    '@type': 'Organization',
    name: tools.cleanText($collab.textContent)
  };

};


exports.personName = function($name){
  if(! $name) return;

  var person = { '@type': 'Person' };

  var $givenNames = $name.getElementsByTagName('given-names')[0];
  if($givenNames){
    person.givenName = tools.cleanText($givenNames.textContent);
  }
  var $surname = $name.getElementsByTagName('surname')[0];
  if($surname){
    person.familyName = tools.cleanText($surname.textContent);
  }

  var $prefix = $name.getElementsByTagName('prefix')[0];
  if($prefix){
    person.honorificPrefix = tools.cleanText($prefix.textContent);
  }

  var $suffix = $name.getElementsByTagName('suffix')[0];
  if($suffix){
    person.honorificSuffix = tools.cleanText($suffix.textContent);
  }

  return person;
};

exports.allContributors = function($articleMeta){
  if(! $articleMeta) return;

  var affiliations = exports.affiliations($articleMeta) || {};  
  var emails = exports.emails($articleMeta) || {};

  var allContributors = {};
  
  var author;
  var contributor = [];
  var accountablePerson = [];
  var editor = [];

  var $contribGroups = $articleMeta.getElementsByTagName('contrib-group');
  if($contribGroups){
    Array.prototype.forEach.call($contribGroups, function($contribGroup){
      var authCnt = 0;
      Array.prototype.forEach.call($contribGroup.childNodes, function($el){
        if($el.tagName === 'contrib'){
          var $contrib = $el;
          var contribType = $contrib.getAttribute('contrib-type');

          //try to get a Person
          var person = exports.personName($contrib.getElementsByTagName('name')[0] || $citation.getElementsByTagName('string-name')[0])  || { '@type': 'Person' };

          var $role = $contrib.getElementsByTagName('role')[0];
          if($role){
            person.jobTitle = tools.cleanText($role.textContent);
          }

          var affiliation = [];
          var email;

          var corresp = !!($contrib.getAttribute('corresp') === 'yes');

          var $xrefs = $contrib.getElementsByTagName('xref');
          if($xrefs){
            Array.prototype.forEach.call($xrefs, function($xref){            
              var refType = $xref.getAttribute('ref-type');
              var rid = $xref.getAttribute('rid');

              if(refType === 'aff'){
                if(affiliations[rid]){
                  affiliation = affiliation.concat(affiliations[rid]);
                }
              } else if(refType === 'corresp'){
                if(emails[rid]){
                  email = emails[rid];
                }
                corresp = true;
              }
            });
          }

          var $email = $contrib.getElementsByTagName('email')[0];
          if($email){
            email = $email.textContent;
          }

          if(email){
            person.email = email
          }
          if(affiliation.length){
            person.affiliation = affiliation;          
          }

          var collab = exports.collab($contrib.getElementsByTagName('collab')[0]);
          if(Object.keys(person).length === 1 && collab){
            person = collab;
          }

          if(!contribType || contribType === 'author'){

            if(authCnt++ === 0){
              author = person;
            } else {
              contributor.push(person);
            }

            if (corresp){
              accountablePerson.push(person);
            }

          } else if(contribType === 'editor'){

            editor.push(person);            

          }

        }
      });
    });
  }

  if(author && Object.keys(author).length > 1){
    allContributors.author = author;
  }

  if(contributor && contributor.length){
    allContributors.contributor = contributor;
  }

  if(editor && editor.length){
    allContributors.editor = editor;
  }

  if(accountablePerson && accountablePerson.length){
    allContributors.accountablePerson = accountablePerson;
  }

  if(Object.keys(allContributors).length){
    return allContributors;
  }
  
};

exports.headline = function($articleMeta){
  if(! $articleMeta) return;
  
  var $articleTitle = $articleMeta.getElementsByTagName('article-title')[0];
  if($articleTitle){
    return tools.cleanText($articleTitle.textContent);
  }
};

exports.alternativeHeadline = function($articleMeta){
  if(! $articleMeta) return;

  var $altTitle = $articleMeta.getElementsByTagName('alt-title')[0];
  if($altTitle){
    return tools.cleanText($altTitle.textContent);
  }

};

/**
 * Grants are put in http://www.schema.org/sourceOrganization
 */ 
exports.sourceOrganization = function($article){

  var sourceOrganization = [];  

  //case 1: <funding-statement> without <funding-source> and without <award-id>
  var $fundingStatements = $article.getElementsByTagName('funding-statement');
  if($fundingStatements && $fundingStatements.length){
    Array.prototype.forEach.call($fundingStatements, function($fundingStatement){
      var isfundingSource = $fundingStatement.getElementsByTagName('funding-source')[0];
      var isAwardId = $fundingStatement.getElementsByTagName('award-id')[0];
      if(!isfundingSource || !isAwardId){
        sourceOrganization.push({description: tools.cleanText($fundingStatement.textContent)});
      }
    });
  }

  //case 2: <funding-source> and <award-id> the "challenge" is to group the 2 together
  var tmpGrant = {};

  var $fundingSources = $article.getElementsByTagName('funding-source');
  if($fundingSources && $fundingSources.length){
    Array.prototype.forEach.call($fundingSources, function($fundingSource){    
      var id = $fundingSource.getAttribute('id');
      var rid = $fundingSource.getAttribute('rid');
      var country = $fundingSource.getAttribute('country');
      var furl = $fundingSource.getAttribute('xlink:href');

      var s = {};
      if(furl){
        s['@id'] = furl;
      }        
      s['@type'] = 'Organization';
      s['name'] = tools.cleanText($fundingSource.textContent);         
      if(country){
        s.address = {'@type': 'PostalAddress', addressCountry: country };
      }

      if(id || rid){ //we will get <award-id> with matching id or rid later

        tmpGrant[id || rid] = s;

      } else if((Object.keys(tmpGrant)
                 .filter(function(k){ return tmpGrant[k].name; })
                 .map(function(k){ return tmpGrant[k].name; })
                 .indexOf(s.name) === -1) &&
                (sourceOrganization
                 .filter(function(x){ return x.name; })
                 .map(function(x){ return x.name; })
                 .indexOf(s.name) === -1)) {

        //check if we can find an associated <award-id>

        var $group = $fundingSource.parentNode;
        if($group && ($group.tagName === 'funding-group' || $group.tagName === 'award-group')){

          var $awardIds = $group.getElementsByTagName('award-id');
          if($awardIds){
            if($awardIds.length === 1){
              s.grantId = tools.cleanText($awardIds[0].textContent);
            } else if ($awardIds.length >1){ //multiple <award-id>, we suppose they are all attached to the funding source => can only make association if there is only 1 funding source
              var $localFoundingSources = $group.getElementsByTagName('founding-source');
              if($localFoundingSources && $localFoundingSources.length ===1){
                s.grantId = Array.prototype.map.call($awardIds, function($awardId){
                  return tools.cleanText($awardId.textContent);
                });
              }
            }
          }
        }             

        sourceOrganization.push(s);
      }

    });
  }

  //get <award-id> with id or rid or orphan ones (the one grouped in <funding-group> or <award-group> have been handled above)
  var $awardIds = $article.getElementsByTagName('award-id');
  if($awardIds && $awardIds.length){
    Array.prototype.forEach.call($awardIds, function($awardId){    

      var id = $awardId.getAttribute('id') || $awardId.getAttribute('rid');
      var awardId = tools.cleanText($awardId.textContent);

      if(id && (id in tmpGrant)){

        if(tmpGrant[id]['grantId']){
          if(Array.isArray(tmpGrant[id]['grantId'])){
            if(tmpGrant[id]['grantId'].indexOf(awardId) === -1){
              tmpGrant[id]['grantId'].push(awardId);
            }
          } else if(tmpGrant[id]['grantId'] !== awardId){
            tmpGrant[id]['grantId'] = [tmpGrant[id]['grantId'], awardId];
          }
        } else {
          tmpGrant[id]['grantId'] = awardId;
        }

      } else { //might be orphan i.e just an <award-id> without associated <funding-source>

        var isFundingSources = !! $awardId.parentNode.getElementsByTagName('funding-source')[0];
        if(!isFundingSources){ //orphan
          if ((Object.keys(tmpGrant)
               .filter(function(k){ return tmpGrant[k].grantId; })
               .map(function(k){ return tmpGrant[k].grantId; })
               .indexOf(awardId) === -1) &&
              (sourceOrganization
               .filter(function(x){ return x.grantId; })
               .map(function(x){ return x.grantId; })
               .indexOf(awardId) === -1)) {

            sourceOrganization.push({grantId: awardId});

          }
        }

      }
      
    });
  }

  for(var keyId in tmpGrant){    
    sourceOrganization.push(tmpGrant[keyId]);
  }

  if(sourceOrganization.length){
    return sourceOrganization;
  }

};

exports.citation = function($ref){
  var ref = {};

  var id = $ref.getAttribute('id');
  if(id){
    ref.name = id;
  }

  var $label = $ref.getElementsByTagName('label')[0];
  if($label && $label.parentNode.tagName === 'ref'){
    ref.alternateName = tools.cleanText($label.textContent);
  }

  var $citation = $ref.getElementsByTagName('mixed-citation')[0] || $ref.getElementsByTagName('element-citation')[0];
  if($citation){

    var $pubIds = $citation.getElementsByTagName('pub-id');
    if($pubIds && $pubIds.length){
      Array.prototype.forEach.call($pubIds, function($pubId){
        var pubIdType = $pubId.getAttribute('pub-id-type');          
        if(pubIdType){ //doi, pmid...
          ref[pubIdType] = $pubId.textContent;
        }
      });
    }

    //try again to get doi 
    if(!ref.doi){
      var $comment = $citation.getElementsByTagName('comment')[0];
      if($comment){
        var $extLinks = $comment.getElementsByTagName('ext-link');
        if($extLinks){
          Array.prototype.forEach.call($extLinks, function($extLink){
            var href = $extLink.getAttribute('xlink:href');
            if(href && isUrl(href)){
              var purl = url.parse(href);
              if(purl.host === 'dx.doi.org'){
                ref.doi = purl.pathname.replace(/^\//, '');
              }
            }
          });
        }
      }
    }

    //try to get ref.url
    if(ref.doi){
      ref.url = 'http://dx.doi.org/' + ref.doi;
      if(ref.pmid){
        ref.sameAs = 'http://www.ncbi.nlm.nih.gov/pubmed/' + ref.pmid;
      }
    } else if(ref.pmid){
      ref.url = 'http://www.ncbi.nlm.nih.gov/pubmed/' + ref.pmid;
    } else {
      var $extLinks = $citation.getElementsByTagName('ext-link');
      if($extLinks){
        for(var i=0; i<$extLinks.length; i++){
          if(['uri', 'ftp'].indexOf($extLinks[i].getAttribute('ext-link-type'))>-1){
            var uriHref = $extLinks[i].getAttribute('xlink:href');
            if(uriHref && isUrl(uriHref)){
              ref.url = uriHref;
            }
          }
        }
      }
    }       

    var publicationType = $citation.getAttribute('publication-type');

    var $articleTitle = $citation.getElementsByTagName('article-title')[0];
    var $source = $citation.getElementsByTagName('source')[0];
    
    if(publicationType === 'journal'){

      ref['@type'] = 'ScholarlyArticle';
      if($articleTitle){
        //QUESTION: use name instead of headline (but conflict with the id)
        ref.headline = tools.cleanText($articleTitle.textContent);
      }

      var periodical = { '@type': 'Periodical' };

      if($source){ //!!<source> in an article it's the peridical name, in a book, it's the book title
        periodical.name = tools.cleanText($source.textContent);
      }

      var $issn = $citation.getElementsByTagName('issn')
      if($issn){
        periodical.issn = exports.issn($issn);
      }

      //issue, volume, periodical, all nested...
      var isPartOf;

      var publicationIssue = exports.publicationIssue($citation);
      if(publicationIssue){
        isPartOf = publicationIssue;
      }

      var publicationVolume = exports.publicationVolume($citation);
      if(publicationVolume){
        if(publicationIssue){
          publicationIssue.isPartOf = publicationVolume;
        } else {
          isPartOf = publicationVolume;
        }
      }

      if(Object.keys(periodical).length >1){
        if(publicationVolume){
          publicationVolume.isPartOf = periodical;
        } else if (publicationIssue){
          publicationIssue.isPartOf = periodical;
        } else {
          isPartOf = periodical;
        }
      }

      if(isPartOf){
        ref.isPartOf = isPartOf;
      }

    } else {

      if(publicationType === 'book'){
        ref['@type'] = 'Book'; 
      } else {
        ref['@type'] = 'CreativeWork'; 
      }

      //TODO <chapter-title> ??

      if($source){
        //QUESTION: use name instead of headline (but conflict with the id)
        ref.headline = tools.cleanText($source.textContent);
      } else if($articleTitle){ //try again... sometimes there are no <source> but <article-title>...
        ref.headline = tools.cleanText($articleTitle.textContent);
      }

      var $isbn = $citation.getElementsByTagName('isbn')[0];
      if($isbn){
        ref.isbn = tools.cleanText($articleTitle.textContent);
      }
    }

    var $comment = $citation.getElementsByTagName('comment')[0];
    if ($comment){
      ref.comment = { '@type': 'Comment', text: tools.cleanText($comment.textContent) };
    }
    
    var publisher = exports.publisher($ref);
    if(publisher){
      ref.publisher = publisher;
    }

    var pageStart = exports.pageStart($ref);
    if(pageStart !== undefined){
      ref.pageStart = pageStart;
    }

    var pageEnd = exports.pageEnd($ref);
    if(pageEnd !== undefined){
      ref.pageEnd = pageEnd;
    }
    
    var jsDate = _getDate($citation);

    if(jsDate){
      try{
        ref.datePublished = jsDate.toISOString();
      } catch(e){};
    }

    //authors
    var $names = $citation.getElementsByTagName('name');
    if(!($names && $names.length)){
      $names = $citation.getElementsByTagName('string-name');
    }

    var $collabs = $citation.getElementsByTagName('collab');
    
    if($names && $names.length){

      Array.prototype.forEach.call($names, function($name, i){

        var person = exports.personName($name)  || { '@type': 'Person' };

        if(i===0){
          ref.author = person;
        } else {
          if(!ref.contributor){
            ref.contributor = [];
          }
          ref.contributor.push(person);
        }

      });

      if($citation.getElementsByTagName('etal')[0]){
        ref.unnamedContributors = true; //indicates that more than the listed author and contributors.
      }

    } else if($collabs && $collabs.length) {

      Array.prototype.forEach.call($names, function($collab, i){      
        var collab = exports.collab($collab) || { '@type': 'Organization' };
        if(i === 0){
          ref.author = collab;
        } else {
          if(ref.contributor){
            ref.contributor.push(collab);
          } else {
            ref.contributor = [ collab ];
          }
        }
      });

    }

  }

  if(Object.keys(ref).length){
    return ref;
  }
};


exports.citations = function($article){
  if(!$article) return;

  var citations = [];
  
  var $back = $article.getElementsByTagName('back')[0]; //http://jats.nlm.nih.gov/archiving/tag-library/1.1d1/index.html <back>Back Matter Back matter typically contains supporting material such as an appendix, acknowledgment, glossary, or bibliographic reference list.

  var $refList;
  if($back){
    $refList = $back.getElementsByTagName('ref-list')[0];
  } else {
    $refList = $article.getElementsByTagName('ref-list')[0];
  }

  if($refList){
    var $refs = $refList.getElementsByTagName('ref');
    if($refs){
      Array.prototype.forEach.call($refs, function($ref){
        var ref = exports.citation($ref);
        if(ref){
          citations.push(ref);
        }
      });
    }
  }

  if(citations.length){
    return citations;
  }
};


exports.inlines = function($article){
  if(!$article) return;
  
  //inline content (get a list of ids from xlink:href)
  var inlines = [];

  //inline-formula contain inline-graphic so no need to take special case of inline-formula into account
  var $inlineGraphics = $article.getElementsByTagName('inline-graphic');
  if($inlineGraphics && $inlineGraphics.length){
    Array.prototype.forEach.call($inlineGraphics, function($inlineGraphic){
      inlines.push($inlineGraphic.getAttribute('xlink:href'));
    });
  }

  ['chem-struct-wrap', 'disp-formula'].forEach(function(inlineTag){
    var $els = $article.getElementsByTagName(inlineTag);
    if($els && $els.length){
      Array.prototype.forEach.call($els, function($el){
        var $graphic = $el.getElementsByTagName('graphic')[0];
        if($graphic){
          inlines.push($graphic.getAttribute('xlink:href'));
        }
      });
    }
  });
  
  if(inlines.length){
    return _.uniq(inlines);
  }

};



exports.datePublished = function($articleMeta){
  if(! $articleMeta) return;

  var $pubDate = $articleMeta.getElementsByTagName('pub-date');
  var jsDate;
  for(i=0; i<$pubDate.length; i++){
    var iso = $pubDate[i].getAttribute('iso-8601-date');
    
    if(iso){
      jsDate = new Date(iso);
    } else {
      jsDate = _getDate($pubDate[i]);
    }

    if($pubDate[i].getAttribute('pub-type') === 'epub' || $pubDate[i].getAttribute('publication-format') === 'electronic'){
      break;
    }
  }

  if(jsDate){
    return jsDate.toISOString();
  }
};

exports.publicationVolume = function($articleMeta){
  if(! $articleMeta) return;

  var $volume = $articleMeta.getElementsByTagName('volume')[0];
  if($volume){
    return {
      '@type': 'PublicationVolume',
      volumeNumber: parseInt($volume.textContent, 10)
    };
  }
};

exports.publicationIssue = function($articleMeta){
  if(! $articleMeta) return;

  var $issue = $articleMeta.getElementsByTagName('issue')[0];
  if($issue){
    return {
      '@type': 'PublicationIssue',
      issueNumber: parseInt($issue.textContent, 10)
    };
  }
};

exports.pageStart = function($articleMeta){
  if(! $articleMeta) return;

  var $fpage = $articleMeta.getElementsByTagName('fpage')[0];
  if($fpage){
    return parseInt($fpage.textContent, 10);
  }
};

exports.pageEnd = function($articleMeta){
  if(! $articleMeta) return;

  var $lpage = $articleMeta.getElementsByTagName('lpage')[0];
  if($lpage){
    return parseInt($lpage.textContent, 10);
  }
};

exports.pageCount = function($articleMeta){
  if(! $articleMeta) return;

  var $pageCount = $articleMeta.getElementsByTagName('page-count')[0];
  if($pageCount){
    var pageCountCount = $pageCount.getAttribute('count');
    if(pageCountCount){
      return parseInt(pageCountCount, 10);
    }    
  }
};

exports.copyrightYear = function($articleMeta){
  if(! $articleMeta) return;

  var $copyrightYear = $articleMeta.getElementsByTagName('copyright-year')[0];
  if($copyrightYear){
    return parseInt($copyrightYear.textContent, 10);
  }
};


exports.copyrightHolder = function($articleMeta){
  if(! $articleMeta) return;

  var $copyrightHolder = $articleMeta.getElementsByTagName('copyright-holder')[0];
  if($copyrightHolder){
    return {name: tools.cleanText($copyrightHolder.textContent)};
  }
};


exports.license = function($articleMeta){
  if(! $articleMeta) return;

  var $license = $articleMeta.getElementsByTagName('license')[0];
  if($license){
    var license = {};

    var licenseLink = $license.getAttribute('xlink:href');
    if(licenseLink && isUrl(licenseLink)){
      license.url = licenseLink;
    } 

    var licenseType = $license.getAttribute('license-type');
    if(licenseType){
      license.name = licenseType;
    }

    var $licenseP = $license.getElementsByTagName('license-p');
    if($licenseP && $licenseP.length){
      license.text = tools.cleanText(Array.prototype.map.call($licenseP, function(p){ return tools.cleanText(p.textContent);}).join(' '));
    }

    if(Object.keys(license).length){
      return license;
    }
  }
};


exports.abstract = function($articleMeta){
  if(! $articleMeta) return;

  var $abstracts = $articleMeta.getElementsByTagName('abstract');
  if($abstracts && $abstracts.length){
    return Array.prototype.map.call($abstracts, function($abstract){

      var myAbstract = { '@type': 'Abstract' };
      var abstractType = $abstract.getAttribute('abstract-type');
      if(abstractType){
        myAbstract.name = abstractType;
      }

      var $secs = $abstract.getElementsByTagName('sec');
      if($secs && $secs.length){ //structured abstract
        myAbstract.hasPart = Array.prototype.map.call($secs, function($sec){
          var part = { '@type': 'Abstract' };
          var $title = $sec.getElementsByTagName('title')[0];
          if($title){
            part.headline = tools.cleanText($title.textContent);
          }
          part.abstractBody = _getTextExcludingTagNames($sec, ['title']);

          return part;
        });

      } else {

        myAbstract.abstractBody = tools.cleanText($abstract.textContent);

      }

      
      return myAbstract;

    });
  }

};


exports.resources = function($article, resources){
  if(! $article) return;
  
  var resourcesMeta = _findResourcesMeta($article); 

  var typeMap = { 'image': 'encoding', 'audio': 'encoding', 'video': 'encoding', 'sourceCode': 'targetProduct', 'dataset': 'distribution', 'article': 'encoding' };

  var sresources = {};
  var allMatchedNames = {
    dataset: [],
    sourceCode: [],
    image: [],
    audio: [],
    video: [],
    article: []
  };

  resourcesMeta.forEach(function(mr, mrId){ //mr: resource with meta data (hence the m...)

    var hrefs = [];
    ['graphic', 'media', 'code', 'table', 'si', 'inlineSi'].forEach(function(type){
      if(type in mr){
        mr[type].forEach(function(x){
          if(x.href){
            hrefs.push(x.href);
          }
        });
      }
    });

    var matched = [];
    Object.keys(resources).forEach(function(type){
      (resources[type] || []).forEach(function(r){
        var tr = {type: type, value: r};

        if(_match(r, type, hrefs)){
          matched.push(tr);
          allMatchedNames[type].push(r.name);
        }
      });
    });

    //get **main** ldpm type (dataset, image, audio, video or sourceCode)
    var mainLdpmType;

    var mainTypeFromFiles;
    var typesFromFiles = {};
    if(matched.length){
      typesFromFiles = _.countBy(matched, function(x){ return x.type; });
    }
    if ('dataset' in typesFromFiles){
      mainTypeFromFiles = 'dataset';
    } else if ('sourceCode' in typesFromFiles){
      mainTypeFromFiles = 'sourceCode';
    } else if ('video' in typesFromFiles){
      mainTypeFromFiles = 'video';
    } else if ('audio' in typesFromFiles){
      mainTypeFromFiles = 'audio';
    } else if ('image' in typesFromFiles){
      mainTypeFromFiles = 'image';
    } else if ('article' in typesFromFiles){
      mainTypeFromFiles = 'article';
    } else {
      mainTypeFromFiles = 'dataset';
    }

    //assign ```mainLdpmType```
    if (mr.tag === 'table-wrap'){

      mainLdpmType = 'dataset';

    } else if ('code' in mr){

      mainLdpmType = 'sourceCode';

    } else if ( ('si' in mr) || ('inlineSi' in mr) ){ //if si or inlineSi => only 1 resource (Cf. findResourcesMeta)

      var mymr = (mr.si && mr.si[0]) || (mr.inlineSi && mr.inlineSi[0]);
      if(mymr.mimetype.indexOf('video') > -1){
        mainLdpmType = 'video';
      } else if (mymr.mimetype.indexOf('audio') > -1){
        mainLdpmType = 'audio';
      } else if (mymr.mimetype.indexOf('image') > -1){
        mainLdpmType = 'image';
      } else { //rely on typesFronFiles or default to dataset
        mainLdpmType = mainTypeFromFiles;
      }

    } else if ('media' in mr){
      
      var typesFromMedia = _.countBy(mr.media, function(x){
        if(x.mimetype.indexOf('video') > -1){
          return 'video';
        } else if (x.mimetype.indexOf('audio') > -1){
          return 'audio';
        } else if (x.mimetype.indexOf('image') > -1){
          return 'image';
        } else {
          return '?';
        }
      });

      if ('video' in typesFromMedia){
        mainLdpmType = 'video';
      } else if ('audio' in typesFromMedia){
        mainLdpmType = 'audio';
      } else if ('image' in typesFromMedia){
        mainLdpmType = 'image';
      } else {
        mainLdpmType = mainTypeFromFiles;
      }
      
    } else if ('graphic' in mr){
      
      mainLdpmType = 'image';

    } else {

      mainLdpmType = mainTypeFromFiles || 'dataset'; 

    }


    var sr = {}; //the new resources we are creating. All matched resource will indeed be different representation of this same resource ```sr```...
    sr.name = mr.id || (matched.length &&  matched[0].value.name) || ('resource-' + mrId);

    if(mr.label) sr.alternateName = mr.label;

    if(mr.caption){
      if(mr.caption.title) sr.description = mr.caption.title;
      if(mr.caption.content){
        if(mainLdpmType === 'image' || mainLdpmType === 'video'){
          sr.caption = mr.caption.content; 
        } else {
          sr.description = tools.cleanText([sr.description || '', mr.caption.content].join(' '));
        }
      }
    }

    if(mr.ids){
      for(var key in mr.ids){
        sr[key] = mr.ids[key];
      }
    }
    
    if(mr.fn && mr.fn.length){
      var comments = [];
      mr.fn.forEach(function(c){
        var comment = {'@type': 'Comment'};
        if(c.id) comment.name = c.id;
        if(c.label) comment.alternateName = c.alternateName;
        if(c.content) comment.text = c.content;
        if(Object.keys(comment).length>1){
          comments.push(comment);
        }
      });
      if(comments.length){
        sr.comment = comments;
      }
    }

    
    var encodings = [];
    if (matched.length) {

      //add type specific props !== encoding infered from ldpm init (e.g about, programmingLanguage...)
      var props = Object.keys(sr);
      matched.forEach(function(x){
        if(x.type === mainLdpmType){          
          Object.keys(x.value).forEach(function(p){
            if(p !== typeMap[mainLdpmType] && props.indexOf(p)=== -1){
              sr[p] = clone(x.value[p]);
            }
          });
        }
      });
      
      //fill encoding

      //special case for pubmed central: 2 representation one .jpg and .gif: in this case: .gif is the thumbnail
      if (mainLdpmType === 'image' &&
          matched[0].type === 'image' &&
          matched.length === 1 &&
          matched[0].value.encoding &&
          matched[0].value.encoding.length === 2 &&
          ( ( matched[0].value.encoding[0].encodingFormat === 'image/gif' && matched[0].value.encoding[1].encodingFormat === 'image/jpeg' ) || ( matched[0].value.encoding[0].encodingFormat === 'image/jpeg' && matched[0].value.encoding[1].encodingFormat === 'image/gif') )
         ){

        encodings = matched[0].value.encoding.filter(function(x){ return x.encodingFormat === 'image/jpeg'; });
        sr.thumbnailPath = (sr.thumbnailPath || []).concat(
          matched[0].value.encoding
            .filter(function(x){ return x.encodingFormat === 'image/gif'; })
            .map(function(x){ return x.contentPath; })
        );

      } else {

        matched.forEach(function(x){
          if(x.type === mainLdpmType){

            encodings = encodings.concat(x.value[typeMap[mainLdpmType]]);

          } else if(x.type === 'image') { //treats as thumbnailPath -> ldpm will transform thumbnailPath into thumbnailUrl

            var thumbnailPaths = x.value.encoding.map(function(enc){ return enc.contentPath; });

            if(thumbnailPaths.length){
              sr.thumbnailPath = (sr.thumbnailPath || []).concat(thumbnailPaths);
            }
          }
        });
      }

    }

    //add HTML representation of a table or code snippet (sampleType)
    if(mainLdpmType === 'dataset'){

      if (mr.table && mr.table.length){
        encodings = encodings.concat(mr.table.map(function(t){
          return {
            contentData: t.html,
            encodingFormat: 'text/html'
          };                
        }));
      };

    } else if (mainLdpmType === 'sourceCode'){ //code snippet

      if(mr.code && mr.code.length === 1){
        Object.keys(mr.code[0]).forEach(function(key){
          if (mr.code[0][key]) {
            sr[key] = mr.code[0][key];
          }
        });
      }

    }

    if(encodings.length){ 
      sr[typeMap[mainLdpmType]] = encodings;
    }

    if(mainLdpmType in sresources){
      sresources[mainLdpmType].push(sr);
    } else {
      sresources[mainLdpmType] = [ sr ];
    }
    
  });


  Object.keys(resources).forEach(function(type){
    resources[type] = resources[type]
      .filter(function(x){
        return allMatchedNames[type].indexOf(x.name) === -1;
      })
      .concat(sresources[type] || []);

    if(!resources[type].length){
      delete resources[type];
    }
  });
  
  return resources;

};


/**
 * helper functions
 */



/**
 * find figure, tables, supplementary materials and their captions. 
 */ 
function _findResourcesMeta($article){
  var resources = [];

  var tags = [ 'fig', 'table-wrap', 'supplementary-material' ];

  tags.forEach(function(tag){

    Array.prototype.forEach.call($article.getElementsByTagName(tag), function($el){
      var r = { 
        tag: tag,
        id: $el.getAttribute('id')
      };

      //label -> alternateName
      var $label = $el.getElementsByTagName('label')[0];      
      if($label){
        r.label = tools.cleanText($label.textContent);
      }
      if(r.label){
        if(r.label.match(/\d+$/)){
          r.num = r.label.match(/\d+$/)[0];
        }
      }

      //caption
      //<title> -> description.
      //<p>s -> caption if and only if it's ONLY plain text i.e does not contain (inline-graphic or formula)
      var $caption = $el.getElementsByTagName('caption')[0];
      if($caption){
        r.caption = {};
        var $title = $caption.getElementsByTagName('title')[0];
        if($title){
          r.caption.title = tools.cleanText($title.textContent);
        }

        var $ps = $caption.getElementsByTagName('p');
        if($ps && $ps.length && _isPlainText($caption)){
          //TODO replace <xref ref-type="bibr" rid="pcbi.1000960-Romijn1">[24]</xref> by the description of the ref
          r.caption.content = Array.prototype.map.call($ps, function($p){
            return tools.cleanText($p.textContent);
          }).join(' ');

          r.caption.content = tools.cleanText(r.caption.content);
        }
      }

      //DOI and co.
      //We only support figure level DOIs: check that parent is ```tag``` if not discard
      var $objectIds = $el.getElementsByTagName('object-id');
      if($objectIds && $objectIds.length){
        r.ids = {};
        Array.prototype.forEach.call($objectIds, function($o){
          if($o.parentNode.tagName === tag){
            var pubIdType = $o.getAttribute('pub-id-type');
            if(pubIdType){
              r.ids[pubIdType] = tools.cleanText($o.textContent);
            }
          }
        });
      }

      //footnote -> Comment
      r.fn = [];
      var $fns = $el.getElementsByTagName('fn');
      if($fns && $fns.length){
        Array.prototype.forEach.call($fns, function($fn){
          if(_isPlainText($fn)){
            r.fn.push(_getFn($fn));
          }
        });
      }

      //<table-wrap-foot> e.g PMC3532326 http://www.pubmedcentral.nih.gov/oai/oai.cgi?verb=GetRecord&identifier=oai:pubmedcentral.nih.gov:3532326&metadataPrefix=pmc
      //!!<fn> already parsed...
      var $tableWrapFoot = $el.getElementsByTagName('table-wrap-foot')[0];
      if($tableWrapFoot && _isPlainText($tableWrapFoot)){
        var istableWrapFootFns = $tableWrapFoot.getElementsByTagName('fn')[0];
        if(!istableWrapFootFns){
          r.fn.push(_getFn($tableWrapFoot));
        }
      }


      if(tag === 'supplementary-material' && $el.getAttribute('xlink:href')){ //if no ```xlink:href```: => will be taken into account by graphic, media and code in the ```else```. The reason is that for example, a <supplementary-material> element could contain a description of an animation, including the first frame of the animation (tagged as a <graphic> element), a caption describing the animation, and a cross-reference made to the external file that held the full animation.

        r.si = [ _getIdMimeHref($el) ];

      } else {
        
        //get figure, media, table or code. <alternatives> first. If no alternative check that only 1 graphic or 1 media or 1 table or 1 code
        var $alternatives = $el.getElementsByTagName('alternatives');
        if($alternatives){ //filter to alternatives direct descendant of $el (to avoid the one in caption for instance)
          $alternatives = Array.prototype.filter.call($alternatives, function($alt){
            return !! ($alt.parentNode.tagName === tag);
          });
        }
        

        if($alternatives && $alternatives.length){
          
          ['graphic', 'media', 'code', 'table'].forEach(function(mtag){
            var $mtags = $alternatives[0].getElementsByTagName(mtag);
            if($mtags && $mtags.length){
              r[mtag] = [];
              array.prototype.forEach.call($mtags, function($m){
                if(mtag === 'table'){
                  if(_isplaintext($m)){
                    r[mtag].push( _getTable($m) );
                  }
                } else if (mtag === 'code') {
                  r[mtag].push( _getCode($m) );
                } else {
                  r[mtag].push( _getIdMimeHref($m) );  
                }
              });
            }
          });
          
        } else { //there must be only 1 graphic, media, table or code

          var mym = [];        
          //put mtag that direct descendant of ```tag``` in an array and check length == 1
          ['graphic', 'media', 'code', 'table'].forEach(function(mtag){
            var $m = $el.getElementsByTagName(mtag);
            if( $m && $m.length){ 
              for(var i=0; i<$m.length; i++){
                if( $m[i].parentNode.tagName === tag ){
                  mym.push( { mtag: mtag, value: $m[i] } );
                }
              }
            }
          });
          
          if(mym.length === 1){            
            if(mym[0].mtag === 'table'){
              if(_isPlainText(mym[0].value)){
                r[mym[0].mtag] =  [ _getTable(mym[0].value) ];
              }
            } else if (mym[0].mtag === 'code'){
              r[mym[0].mtag] =  [ _getCode(mym[0].value) ];
            } else {
              r[mym[0].mtag] = [ _getIdMimeHref(mym[0].value) ];
            }
          }

        }
      }

      resources.push(r);
    });

  });

  //<inline-supplementary-material>
  //@xlink:title -> description
  var $inlineSupplementaryMaterials = $article.getElementsByTagName('inline-supplementary-material');
  if($inlineSupplementaryMaterials && $inlineSupplementaryMaterials.length){
    Array.prototype.forEach.call($inlineSupplementaryMaterials, function($sup){
      resources.push({
        tag: 'inline-supplementary-material',
        id: $sup.getAttribute('id'),
        caption: { title: $sup.getattribute('xlink:title') },
        inlineSi: [ _getIdMimeHref($sup) ]
      });
    });
  }

  return resources;
};


function _getDate($node){
  var jsDate;
  
  var $day = $node.getElementsByTagName('day')[0];
  var $month = $node.getElementsByTagName('month')[0];
  var $year = $node.getElementsByTagName('year')[0];

  var jsDate, month;
  
  if($month){
    month = $month.textContent.toLowerCase().substring(0,3);

    var month2int = {
      'jan': 0,
      'feb': 1,
      'mar': 2,
      'apr': 3,
      'may': 4,
      'jun': 5,
      'jul': 6,
      'aug': 7,
      'sep': 8,
      'oct': 9,
      'nov': 10,
      'dec': 11
    };

    if(month in month2int){
      month = month2int[month];
    } else {
      month -= 1; //in JS date constructor, month start at 0...
    }    
  }
  
  if($year && month && $day){        
    jsDate = Date.UTC($year.textContent, month, $day.textContent, 0, 0, 0, 0);
  } else if($year && month){
    jsDate = Date.UTC($year.textContent, month, 1, 0, 0, 0, 0);
  } else if($year){
    jsDate = Date.UTC($year.textContent, 0, 1, 0, 0, 0, 0);
  }

  return new Date(jsDate - 1000*5*60*60); //UTC to Eastern Time Zone (UTC-05:00)
};


function _getTextExcludingTagNames($node, tagNamesToExclude){
  var txt = '';
  
  Array.prototype.forEach.call($node.childNodes, function($el){
    if(tagNamesToExclude.indexOf($el.tagName) === -1){
      if($el.nodeType === 3){
        txt += $el.textContent;
      } else if ($el.nodeType === 1){
        txt += _getTextExcludingTagNames($el, tagNamesToExclude);
      }
    }
  });

  return txt;
};


/**
 * return undefined if the table contains element that cannot be serialized (e.g graphics, media, formulaes)
 * TODO replace <bold> and other tags...
 */
function _getTable($table){
  _removeAttributes($table);

  var serializer = new XMLSerializer();

  return {
    id: $table.getAttribute('id'),
    html: [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      '</head>',
      '<body>',
      serializer.serializeToString($table),
      '</body>',
      '</html>'
    ].join('')
  };
};

function _getIdMimeHref($el){
  return {
    id: $el.getAttribute('id'),
    mimetype: $el.getAttribute('mimetype'),
    mimeSubtype: $el.getAttribute('mime-subtype'),
    href: $el.getAttribute('xlink:href')
  };
};


function _getCode($code){
  return {
    programmingLanguage: $code.getAttribute('code-type') || $code.getAttribute('language'),
    runtime: $code.getAttribute('platforms'),    
    sampeType: $code.textContent
  };
};


function _getFn($fn){
  var fn = { id: $fn.getAttribute('id') };

  var $title = $fn.getElementsByTagName('title')[0];
  if($title){
    fn.title = tools.cleanText($title.textContent);
  }

  var $label = $fn.getElementsByTagName('label')[0];
  if($label){
    fn.label = tools.cleanText($label.textContent);
  }

  var $ps = $fn.getElementsByTagName('p');
  if($ps && $ps.length){
    fn.content = Array.prototype.map.call($ps, function($p){
      return tools.cleanText($p.textContent);
    }).join(' ');

    fn.content = tools.cleanText(fn.content);
  }

  return fn;
};


function _isPlainText($el){
  //note: inline-formula contains inline-graphic so no need to check it.
  var evilTags = ['inline-graphic', 'chem-struct-wrap', 'disp-formula', 'graphic', 'media'];
  for(var i=0; i<evilTags.length; i++){
    if ($el.getElementsByTagName(evilTags[i])[0]){
      return false;
    }
  }

  return true;
};


function _removeAttributes($el){
  
  if($el.attributes && $el.attributes.length){
    var atts = Array.prototype.map.call($el.attributes, function(x){return x.name;});
    if(atts.length){
      atts.forEach(function(att){
        $el.removeAttribute(att);      
      })
    }
  }

  if($el.childNodes && $el.childNodes.length){
    for(var i=0; i<$el.childNodes.length; i++){
      _removeAttributes($el.childNodes[i]);
    }
  }

};

function _match(r, type, hrefs){

  var typeMap = { 'image': 'encoding', 'audio': 'encoding', 'video': 'encoding', 'sourceCode': 'targetProduct', 'dataset': 'distribution', 'article': 'encoding' };
  
  if(r[typeMap[type]] && r[typeMap[type]].length){
    for(var i=0; i<r[typeMap[type]].length; i++){
      var mpath = r[typeMap[type]][i].contentPath || r[typeMap[type]][i].bundlePath || r[typeMap[type]][i].filePath; //note: bundlePath is first!
      if(mpath){
        var cext = ['.gz', '.gzip', '.tgz', '.zip', '.tar.gz'];

        var mbase = path.basename(mpath);
        var mname = path.basename(mpath, path.extname(mpath));
        var mnamens = mname.replace(/ /g, '-');

        //in case of compression of a single media file.
        var mnamedir = path.dirname(mpath);
        
        var mynames = [ mbase, mname, mnamens ];
        if(mnamedir !== '.'){
          cext.forEach(function(ext){
            mynames.push(mnamedir + ext);
          });
        }

        if(r[typeMap[type]][i].bundlePath){
          cext.forEach(function(ext){
            mynames.push(mbase + ext);
          });
        }

        if(mynames.some(function(x){ return hrefs.indexOf(x) >-1; })){
          return true;
        }

      }      
    }
  }

  return false;
};


var request = require('request')
  , fs = require('fs')
  , url = require('url')
  , path = require('path')
  , DOMParser = require('xmldom').DOMParser
  , _ = require('underscore')
  , meshTree = require('mesh-tree')
  , SchemaOrgIo = require('schema-org-io')
  , tools = require('./tools');

exports.pubmed = pubmed;
exports.parseXml = parseXml;

/**
 * 'this' is a Dcat instance
 */
function pubmed(pmid, opts, callback){

  if(arguments.length === 2){
    callback = opts;
    opts = {};
  }

  var that = this;

  var uri = 'http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=' + pmid + '&rettype=abstract&retmode=xml';
  that.log('GET', uri);
  request(uri, function(error,response, xml){
    if(error) return callback(error);

    that.log(response.statusCode, uri)

    if(response.statusCode >= 400){
      var err = new Error(xml);
      err.code = response.statusCode;
      return callback(err);
    }

    try{
      var pkg = parseXml(xml, pmid);
    }  catch(err){
      return callback(err);
    }

    callback(null, pkg);
  });

};

/**
 * see http://www.nlm.nih.gov/bsd/licensee/elements_descriptions.html
 */
function parseXml(xml, pmid){
  var doc = new DOMParser().parseFromString(xml, 'text/xml');

  var $PubmedArticle = doc.getElementsByTagName('PubmedArticle')[0];
  if($PubmedArticle){

    var $Journal = $PubmedArticle.getElementsByTagName('Journal')[0];
    var jsDate, periodical;
    if($Journal){
      jsDate = pubmedDatePublished($Journal);
      periodical = pubmedPeriodical($Journal);
    }
    var authors = pubmedAuthors($PubmedArticle);

    var pkgId = [];

    if(periodical && periodical.alternateName){
      pkgId.push(periodical.alternateName.replace(/ /g, '-').replace(/\W/g, '').toLowerCase());
    }

    if(authors.author && authors.author.familyName){
      pkgId.push(tools.removeDiacritics(authors.author.familyName.toLowerCase()).replace(/\W/g, ''));
    }

    if(jsDate){
      pkgId.push(jsDate.getFullYear());
    }

    if(pkgId.length>=2){
      pkgId = pkgId.join('-');
    } else {
      pkgId = pmid.toString();
    }

    var pkg = {
      '@context': SchemaOrgIo.contextUrl,
      '@id': pkgId,
      '@type': 'MedicalScholarlyArticle'
    };
    pkg.version = '0.0.0';

    var sameAs = ['http://www.ncbi.nlm.nih.gov/pubmed/' + pmid];
    var doi = pubmedDoi($PubmedArticle);
    if (doi) { sameAs.push('http://doi.org/' + doi); }


    var keywords = pubmedKeywords($PubmedArticle);
    if(keywords){
      pkg.keywords = keywords;
    }

    if(jsDate){ pkg.datePublished = jsDate.toISOString(); }

    var $ArticleTitle = $PubmedArticle.getElementsByTagName('ArticleTitle')[0];
    if($ArticleTitle){
      pkg.headline = tools.cleanText($ArticleTitle.textContent).replace(/^\[/, '').replace(/\]\.*$/, ''); //remove [] Cf http://www.nlm.nih.gov/bsd/licensee/elements_descriptions.html#articletitle
    }

    if(authors.author){ pkg.author = authors.author; }
    if(authors.contributor){ pkg.contributor = authors.contributor; }

    var $CopyrightInformation = $PubmedArticle.getElementsByTagName('CopyrightInformation')[0];
    if($CopyrightInformation){
      pkg.copyrightHolder = { description: tools.cleanText($CopyrightInformation.textContent) };
    }

    pkg.provider = {
      '@type': 'Organization',
      '@id': 'http://www.ncbi.nlm.nih.gov/pubmed/',
      description: 'From MEDLINE®/PubMed®, a database of the U.S. National Library of Medicine.'
    };

    var sourceOrganization = pubmedSourceOrganization($PubmedArticle);
    if(sourceOrganization){
      pkg.sourceOrganization = sourceOrganization;
    }

    var about = pubmedMesh($PubmedArticle);
    if(about){
      pkg.about = about;
    }

    var abstracts = pubmedAbstract($PubmedArticle);
    if(abstracts){
      pkg.abstract = abstracts;
    }

    //issue, volume, periodical, all nested...
    if($Journal){
      var isPartOf;

      var publicationIssue = pubmedPublicationIssue($Journal);
      if(publicationIssue){
        isPartOf = publicationIssue;
      }

      var publicationVolume = pubmedPublicationVolume($Journal);
      if(publicationVolume){
        if(publicationIssue){
          publicationIssue.isPartOf = publicationVolume;
        } else {
          isPartOf = publicationVolume;
        }
      }

      if(periodical){
        if(publicationVolume){
          publicationVolume.isPartOf = periodical;
        } else if (publicationIssue){
          publicationIssue.isPartOf = periodical;
        } else {
          isPartOf = periodical;
        }
      }

      if(isPartOf){ pkg.isPartOf = isPartOf; }

      //pages (bibo:pages (bibo:pages <-> schema:pagination) or bibo:pageStart and bibo:pageEnd e.g <Pagination> <MedlinePgn>12-9</MedlinePgn>)
      var $Pagination = $PubmedArticle.getElementsByTagName('Pagination')[0];
      if($Pagination){
        var $MedlinePgn = $Pagination.getElementsByTagName('MedlinePgn')[0];
        if($MedlinePgn){
          var medlinePgn = tools.cleanText($MedlinePgn.textContent) || '';
          var rePage = /^(\d+)-(\d+)$/;
          var matchPage = medlinePgn.match(rePage);
          if(matchPage){ //fix ranges like 1199-201 or 12-9
            var pageStart = matchPage[1]
            var pageEnd = matchPage[2];
            if(pageEnd.length < pageStart.length){
              pageEnd = pageStart.substring(0, pageStart.length - pageEnd.length) + pageEnd;
            }
            pkg.pageStart = tools.parseInt(pageStart);
            pkg.pageEnd = tools.parseInt(pageEnd);
          } else {
            pkg.pagination = medlinePgn;
          }
        }
      }
    }

    var citations = pubmedCitations($PubmedArticle);
    if (citations) {
      pkg.citation = citations;
    }

    var dataset = pubmedDataset($PubmedArticle);
    if (dataset) {
      pkg.hasPart = dataset;
    }

  }

  return pkg;
};

function pubmedAuthors($PubmedArticle){
  var authors = {};

  var $AuthorList = $PubmedArticle.getElementsByTagName('AuthorList')[0];
  if($AuthorList){
    var $Authors = $AuthorList.getElementsByTagName('Author');
    if($Authors){
      Array.prototype.forEach.call($Authors, function($Author, i){
        var person = { '@type': 'Person' };

        var $LastName = $Author.getElementsByTagName('LastName')[0];
        if($LastName){
          person.familyName = tools.cleanText($LastName.textContent);
        }

        var $ForeName = $Author.getElementsByTagName('ForeName')[0];
        if($ForeName){
          person.givenName = tools.cleanText($ForeName.textContent);
        }

        if(person.familyName && person.givenName ){
          person.name = person.givenName + ' ' + person.familyName;
        }

        var $Affiliation = $Author.getElementsByTagName('Affiliation')[0];
        if($Affiliation){
          person.affiliation = {
            '@type': 'Organization',
            description: tools.cleanText($Affiliation.textContent)
          }
        }

        if(Object.keys(person).length > 1){
          if(i === 0){
            authors.author = person;
          } else {
            if(!authors.contributor){
              authors.contributor = [];
            }
            authors.contributor.push(person);
          }
        }

      });
    }
  }
  return authors;
};

function pubmedDoi($PubmedArticle){
  var $ELocationID = $PubmedArticle.getElementsByTagName('ELocationID');
  if($ELocationID){
    for(var i=0; i<$ELocationID.length; i++){
      if($ELocationID[i].getAttribute('EIdType') === 'doi'){
        var doiValid = $ELocationID[i].getAttribute('ValidYN');
        if(!doiValid || doiValid === 'Y'){
          return tools.cleanText($ELocationID[i].textContent);
        }
      }
    }
  }
};


function pubmedDatePublished($Journal){
  var $PubDate = $Journal.getElementsByTagName('PubDate')[0];
  if($PubDate){
    var $day = $PubDate.getElementsByTagName('Day')[0];
    var $month = $PubDate.getElementsByTagName('Month')[0];
    var $year = $PubDate.getElementsByTagName('Year')[0];
    var month, jsDate;

    if($month){
      var abrMonth2int = {
        'jan': 0,
        'feb': 1,
        'mar': 2,
        'apr': 3,
        'may': 4,
        'jun': 5,
        'july': 6,
        'aug': 7,
        'sep': 8,
        'oct': 9,
        'nov': 10,
        'dec': 11
      };

      month = abrMonth2int[$month.textContent.trim().toLowerCase()];
    }

    if($year && month && $day){
      jsDate = Date.UTC($year.textContent, month, $day.textContent, 0, 0, 0, 0);
    } else if($year && month){
      jsDate = Date.UTC($year.textContent, month, 1, 0, 0, 0, 0);
    } else if($year){
      jsDate = Date.UTC($year.textContent, 0, 1, 0, 0, 0, 0);
    }

    if(jsDate){
      jsDate = new Date(jsDate - 1000*5*60*60); //UTC to Eastern Time Zone (UTC-05:00)
    } else {
      var $MedlineDate = $PubDate.getElementsByTagName('MedlineDate')[0];
      if($MedlineDate){
        try {
          jsDate = new Date(tools.cleanText($MedlineDate.textContent));
        } catch(e){}
      }
    }
    if(jsDate){
      return jsDate;
    }
  }
};

function pubmedPublicationIssue($Journal){

  var $issue = $Journal.getElementsByTagName('Issue')[0];
  if($issue){
    return {
      '@type': 'PublicationIssue',
      issueNumber: tools.parseInt($issue.textContent)
    };
  }

};

function pubmedPublicationVolume($Journal){

  var $volume = $Journal.getElementsByTagName('Volume')[0];
  if($volume){
    return {
      '@type': 'PublicationVolume',
      volumeNumber: tools.parseInt($volume.textContent)
    };
  }

};

function pubmedPeriodical($Journal){

  var periodical = { '@type': 'Periodical' };

  var $Title = $Journal.getElementsByTagName('Title')[0];
  if($Title){
    periodical.name = tools.cleanText($Title.textContent);
  }

  var $ISOAbbreviation = $Journal.getElementsByTagName('ISOAbbreviation')[0];
  if($ISOAbbreviation){
    periodical.alternateName = tools.cleanText($ISOAbbreviation.textContent);
  }

  var $ISSN = $Journal.getElementsByTagName('ISSN')[0];
  if($ISSN){
    periodical.issn = tools.cleanText($ISSN.textContent);
  }

  if(Object.keys(periodical).length > 1){
    return periodical;
  }

};


/**
 * CF http://www.nlm.nih.gov/bsd/licensee/elements_descriptions.html structured abstract.
 * Abstract can be structured
 *e.g http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=19897313&rettype=abstract&retmode=xml
 */

function pubmedAbstract($PubmedArticle){

  var $Abstracts = $PubmedArticle.getElementsByTagName('Abstract');
  if($Abstracts && $Abstracts.length){

    return Array.prototype.map.call($Abstracts, function($Abstract){

      var myAbstract = { '@type': 'Abstract' };

      var $AbstractTexts = $Abstract.getElementsByTagName('AbstractText');
      if($AbstractTexts && $AbstractTexts.length){

        var parts = Array.prototype.map.call($AbstractTexts, function($AbstractText){
          var part = { '@type': 'Abstract' };
          var nlmCategory = $AbstractText.getAttribute('NlmCategory') || $AbstractText.getAttribute('Label');
          if(nlmCategory){
            part.headline = nlmCategory.trim().toLowerCase();
          }
          part.abstractBody = tools.cleanText($AbstractText.textContent);
          return part;
        });

        if(parts.length === 1){
          if(parts[0].headline){
            myAbstract.headline = parts[0].headline;
          }
          myAbstract.abstractBody = parts[0].abstractBody;
        } else {
          myAbstract.hasPart = parts;
        }

      }

      return myAbstract;

    });

  }

};


/**
 * keywords e.g http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=24920540&rettype=abstract&retmode=xml
 * TODO: take advandage of Owner attribute Cf http://www.nlm.nih.gov/bsd/licensee/elements_descriptions.html#Keyword
 */
function pubmedKeywords($PubmedArticle){

  var keywords = [];
  var $KeywordLists = $PubmedArticle.getElementsByTagName('KeywordList');
  if($KeywordLists){
    Array.prototype.forEach.call($KeywordLists, function($KeywordList){
      var $Keywords = $KeywordList.getElementsByTagName('Keyword');
      if($Keywords){
        Array.prototype.forEach.call($Keywords, function($Keyword){
          keywords.push(tools.cleanText($Keyword.textContent).toLowerCase());
        });
      }
    });
  }

  if(keywords.length){
    return _.uniq(keywords);
  }

};



/**
 * <Grant> as sourceOrganization (grantId is added TODO fix...)
 */
function pubmedSourceOrganization($PubmedArticle){

  var $GrantList = $PubmedArticle.getElementsByTagName('GrantList')[0];
  var soMap = {}; //re-aggregate grant entries by organizations
  if($GrantList){
    var $Grants = $GrantList.getElementsByTagName('Grant');
    if($Grants){
      Array.prototype.forEach.call($Grants, function($Grant, gid){
        var $Agency = $Grant.getElementsByTagName('Agency')[0];
        var $GrantID = $Grant.getElementsByTagName('GrantID')[0];
        var $Acronym = $Grant.getElementsByTagName('Acronym')[0];
        var $Country = $Grant.getElementsByTagName('Country')[0];

        var name;
        if($Agency){
          name = tools.cleanText($Agency.textContent);
        }

        var key = name || gid.toString();

        if($Agency || $GrantID){
          var organization = soMap[key] || { '@type': 'Organization' };
          if(name){
            organization.name = name;
          }
          if($Acronym){
            organization.alternateName = tools.cleanText($Acronym.textContent);
          }
          if($GrantID){ //accumulate grantId(s)...
            var grantId = tools.cleanText($GrantID.textContent);
            if(organization.grantId){
              organization.grantId.push(grantId);
            } else {
              organization.grantId = [grantId];
            }
          }
          if($Country){
            organization.address = {
              '@type': 'PostalAddress',
              'addressCountry': tools.cleanText($Country.textContent)
            }
          }
          soMap[key] = organization;
        }
      });
    }
  }

  var sourceOrganizations = [];
  Object.keys(soMap).forEach(function(key){
    sourceOrganizations.push(soMap[key]);
  })

  if(sourceOrganizations.length){
    return sourceOrganizations;
  }


};


function pubmedCitations($PubmedArticle){

  var citations = [];
  var $CommentsCorrectionsList = $PubmedArticle.getElementsByTagName('CommentsCorrectionsList')[0];
  if($CommentsCorrectionsList){
    var $CommentsCorrections = $CommentsCorrectionsList.getElementsByTagName('CommentsCorrections');
    if($CommentsCorrections){
      Array.prototype.forEach.call($CommentsCorrections, function($CommentsCorrections){
        var ref = {};

        //var refType = $CommentsCorrections.getAttribute('RefType'); TODO can we use that to infer @type ??

        ref['@type'] = 'ScholarlyArticle';

        var $RefSource = $CommentsCorrections.getElementsByTagName('RefSource')[0];
        if($RefSource){
          ref.description = tools.cleanText($RefSource.textContent);
        }

        var $PMID = $CommentsCorrections.getElementsByTagName('PMID')[0];
        if($PMID){
          ref.sameAs = 'http://www.ncbi.nlm.nih.gov/pubmed/' + tools.cleanText($PMID.textContent);
        }

        if(Object.keys(ref).length){
          citations.push(ref);
        }
      });
    }
  }
  if(citations.length){
    return citations;
  }

};



/**
 * dataset: <DataBankList> e.g pmid: 19237716
 * TODO add URI from: http://www.nlm.nih.gov/bsd/medline_databank_source.html
 */
function pubmedDataset($PubmedArticle){

  var datasets = [];
  var $DataBankLists = $PubmedArticle.getElementsByTagName('DataBankList');
  if($DataBankLists){
    Array.prototype.forEach.call($DataBankLists, function($DataBankList){
      var $DataBanks = $DataBankList.getElementsByTagName('DataBank');
      if($DataBanks){
        Array.prototype.forEach.call($DataBanks, function($DataBank){
          var catalogName;
          var $DataBankName = $DataBank.getElementsByTagName('DataBankName')[0];
          if($DataBankName){
            catalogName = tools.cleanText($DataBankName.textContent);
          }

          if(catalogName){
            var $accessionNumberLists = $DataBank.getElementsByTagName('AccessionNumberList');
            if($accessionNumberLists){
              Array.prototype.forEach.call($accessionNumberLists, function($accessionNumberList){
                var $accessionNumbers = $accessionNumberList.getElementsByTagName('AccessionNumber');
                if($accessionNumbers){
                  Array.prototype.forEach.call($accessionNumbers, function($accessionNumber){
                    datasets.push({
                      name: tools.cleanText($accessionNumber.textContent),
                      catalog: { name: catalogName }
                    });
                  });
                }
              });
            }
          }
        });
      }
    });
  }

  if(datasets.length){
    return datasets;
  }

};


function pubmedMesh($PubmedArticle){

  var about = [];

  var $MeshHeadingList = $PubmedArticle.getElementsByTagName('MeshHeadingList')[0];
  if($MeshHeadingList){
    var $MeshHeadings = $MeshHeadingList.getElementsByTagName('MeshHeading');
    if($MeshHeadings && $MeshHeadings.length){
      Array.prototype.forEach.call($MeshHeadings, function($MeshHeading){

        var $DescriptorName = $MeshHeading.getElementsByTagName('DescriptorName')[0];
        if($DescriptorName){
          var meshHeading;

          var name = tools.cleanText($DescriptorName.textContent);
          if(name in meshTree){
            meshHeading = {
              '@id': 'http://www.ncbi.nlm.nih.gov/mesh/' + meshTree[name],
              '@type': 'MedicalEntity',
              name: name,
              code: {
                '@type': 'MedicalCode',
                'codeValue': meshTree[name],
                'codingSystem': 'MeSH'
              }
            };
          } else {
            meshHeading = {
              '@type': 'MedicalEntity',
              name: name
            };
          }

          var majorTopic = $DescriptorName.getAttribute('MajorTopicYN');
          if(majorTopic){
            meshHeading.majorTopic = !!(majorTopic === 'Y');
          }

          var $QualifierNames = $MeshHeading.getElementsByTagName('QualifierName');
          if($QualifierNames && $QualifierNames.length){
            meshHeading.description = Array.prototype.map.call($QualifierNames, function($QualifierName){ return tools.cleanText($QualifierName.textContent); }).join(', ');
          }

          about.push(meshHeading);

        }
      });
    }
  }

  //MeshSupplementaryConcept <SupplMeshList> (e.g http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=12416895&rettype=abstract&retmode=xml)
  var $SupplMeshLists = $PubmedArticle.getElementsByTagName('SupplMeshList');
  if($SupplMeshLists){
    Array.prototype.forEach.call($SupplMeshLists, function($SupplMeshList){
      var $SupplMeshNames = $SupplMeshList.getElementsByTagName('SupplMeshName');
      if($SupplMeshNames){
        Array.prototype.forEach.call($SupplMeshNames, function($SupplMeshName){
          var meshHeading;
          var name = tools.cleanText($SupplMeshName.textContent);
          var description = $SupplMeshName.getAttribute('Type');

          if(name in meshTree){

            meshHeading = {
              '@id': 'http://www.ncbi.nlm.nih.gov/mesh/' + meshTree[name],
              '@type': 'MedicalEntity',
              name: name,
              code: {
                '@type': 'MedicalCode',
                'codeValue': meshTree[name],
                'codingSystem': 'MeSH'
              }
            };

          } else {

            meshHeading = {
              '@type': 'MedicalEntity',
              name: name,
              code: {
                '@type': 'MedicalCode',
                'codingSystem': 'MeSH'
              }
            };
          }

          if(description){
            meshHeading.description = description;
          }

          about.push(meshHeading);

        });
      }
    });
  }

  //MeshSupplementaryConcept <ChemicalList> (e.g http://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=12416895&rettype=abstract&retmode=xml)
  var $ChemicalLists = $PubmedArticle.getElementsByTagName('ChemicalList');
  if($ChemicalLists){
    Array.prototype.forEach.call($ChemicalLists, function($ChemicalList){
      var $Chemicals = $ChemicalList.getElementsByTagName('Chemical');
      if($Chemicals){
        Array.prototype.forEach.call($Chemicals, function($Chemical){


          var $NameOfSubstance = $Chemical.getElementsByTagName('NameOfSubstance')[0];
          if($NameOfSubstance){
            var name = tools.cleanText($NameOfSubstance.textContent);
            var registryNumber;
            var $RegistryNumber = $Chemical.getElementsByTagName('RegistryNumber')[0];
            if($RegistryNumber){
              registryNumber = tools.cleanText($RegistryNumber.textContent);
              if(registryNumber == 0) {
                registryNumber = undefined;
              }
            }

            var meshHeading;

            if(name in meshTree){

              meshHeading = {
                '@id': 'http://www.ncbi.nlm.nih.gov/mesh/' + meshTree[name],
                '@type': 'Drug',
                name: name,
                code: {
                  '@type': 'MedicalCode',
                  'codeValue': meshTree[name],
                  'codingSystem': 'MeSH'
                }
              };

            } else {

              meshHeading = {
                '@type': 'MedicalEntity',
                name: name
              };

            }


            if(registryNumber){
              var code = {
                '@type': 'MedicalCode',
                'codeValue': registryNumber
              };
              meshHeading.code = (meshHeading.code)? [meshHeading.code, code] : code;
            }

            about.push(meshHeading);

          }

        });
      }
    });
  }

  if(about.length){
    return about;
  }

};

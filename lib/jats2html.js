var XMLSerializer = require('xmldom').XMLSerializer
  , isUrl = require('is-url');

/**
 * Cf. http://jats.nlm.nih.gov/archiving/tag-library/1.1d1/index.html
 */

function Jats2Html (ctx, pkg){
  this.pkg = pkg || {};
  this.ctx = ctx || {};
  this.hLevel = 1; //header level: increment for sections...

  if(this.pkg.article){
    this.mainArticle = this.pkg.article.filter(function(x){ 
      return x['@type'] === 'ScholarlyArticle' || x['@type'] === 'MedicalScholarlyArticle';
    })[0] || {};
  }
};

Jats2Html.prototype.parse = function($node){
  var html = '';
  
  if($node.nodeType === 3){
    html += $node.nodeValue
  } else if ($node.nodeType === 1){    
    var tagNameCamelCase = $node.tagName.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    if(tagNameCamelCase in this){
      html += this[tagNameCamelCase]($node);
    } else {
      var s = new XMLSerializer();
      html += '<!--' + s.serializeToString($node) + '-->';
    }
  }

  return html;
};

Jats2Html.prototype._parse = function($node){
  var html = '';
  for(var i=0; i<$node.childNodes.length; i++){
    var $el = $node.childNodes[i];      
    html += this.parse($el);
  }

  return html;
};

Jats2Html.prototype.getAttr = function($node, attrList){

  if(!attrList && $node){
    attrList = [{name: 'id', value: $node.getAttribute('id')}, {name: 'typeOf', value: this.getSectionRdfType($node)}];
  }

  return attrList
    .filter(function(x) {return x.value;})  
    .map(function(x){
      return x.name + '="'+ x.value + '"';
    })
    .join(' ');  

};


Jats2Html.prototype.map = function($node, htmlTagName, attrList){
  var html = '';

  html += this.openingTag($node, htmlTagName, attrList);
  html += this._parse($node);  
  html += '</' + htmlTagName + '>';

  return html;  
};


Jats2Html.prototype.openingTag = function($node, htmlTagName, attrList){

  var attrs = this.getAttr($node, attrList);
  
  var oTag = '<' + htmlTagName;
  if(attrs){
    oTag += ' ' + attrs;
  }  
  oTag += '>';  

  return oTag;
};

Jats2Html.prototype.selfClosingTag = function($node, htmlTagName, attrList){

  var attrs = this.getAttr($node, attrList);
  var tag = '<' + htmlTagName;
  if(attrs){
    tag += ' ' + attrs;
  }  
  tag += ' />';  

  return tag;
};


Jats2Html.prototype.getSectionRdfType = function($node){

  var rdfTypes = [];

  var deo = {
    'intro': 'http://purl.org/spar/deo/Introduction',
    'acknowledgement': 'http://purl.org/spar/deo/Acknowledgements',
    'discussion': 'http://salt.semanticauthoring.org/ontologies/sro#Discussion',
    'material': 'http://purl.org/spar/deo/Materials',
    'method': 'http://purl.org/spar/deo/Methods',
    'result': 'http://purl.org/spar/deo/Results',
    'conclusion': 'http://salt.semanticauthoring.org/documentation.html#Conclusion'
  };
  //synonyms
  deo.introduction = deo.intro;
  Object.keys(deo).forEach(function(key){
    deo[key + 's'] = deo[key];
  });

  var secType = $node.getAttribute('sec-type');
  var $title = $node.getElementsByTagName('title')[0];

  if(secType){
    secType = secType.split('|'); // “sec-type="materials|methods"
  } else if ($title){
    secType = $title.textContent.split(' ');
  }

  
  if(secType){
    secType = secType.map(function(x) {return x.trim().toLowerCase()});
    secType.forEach(function(t){
      if(t in deo){
        rdfTypes.push(deo[t]);
      }
    });
  }

  return rdfTypes.join(' ');
};


//All the tags...

Jats2Html.prototype.article = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'typeOf', value: 'http://schema.org/ScholarlyArticle'}
  ];


  return '<!DOCTYPE html><html><head><meta charset=utf-8 /></head><body>' + this.map($node, 'article', attrList) + '</body></html>';
};


/**
 * Only abstract
 * TODO add all the meta info from the pkg
 */
Jats2Html.prototype.front = function($node){

  this.hLevel++;

  var innerHtml = ''

  var $abstracts = $node.getElementsByTagName('abstract');
  if($abstracts && $abstracts.length){
    for(var i=0; i<$abstracts.length; i++){
      innerHtml += this.parse($abstracts[i]);
    }
  }

  this.hLevel--;

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'typeOf', value: 'http://purl.org/spar/doco/FrontMatter'}
  ];
  
  return (innerHtml)? (this.openingTag($node, 'section', attrList) + innerHtml + '</section>') : '';

};


/**
 * TODO add citations from the pkg
 */
Jats2Html.prototype.back = function($node){

  var innerHtml = ''
  this.hLevel++;

  for(var i=0; i<$node.childNodes.length; i++){
    var $el = $node.childNodes[i];
    if($el.nodeType === 3){

      innerHtml += $el.nodeValue;

    } else if($el.tagName === 'ref-list') {

      innerHtml += this.openingTag($el, 'section', [{
        name: 'id', value: $el.getAttribute('id'),
        name: 'typeOf', value: 'http://purl.org/spar/doco/Bibliography'
      }]);

      innerHtml += this._citations2Html();
      innerHtml += '</section>';
      
    } else {
      
      innerHtml += this.parse($el);
      
    }

  }

  this.hLevel--;

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'typeOf', value: 'http://purl.org/spar/doco/BackMatter'}
  ];
  
  return (innerHtml)? (this.openingTag($node, 'section', attrList) + innerHtml + '</section>') : '';

};


Jats2Html.prototype.body = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'property', value: 'schema:articleBody'}
  ];

  return this.map($node, 'main', attrList);
};

Jats2Html.prototype.sec = function($node){
  var html = '';
  
  this.hLevel++;
  html += this.openingTag($node, 'section');

  for(var i=0; i<$node.childNodes.length; i++){
    var $el = $node.childNodes[i];
    if($el.nodeType === 3){

      html += $el.nodeValue;

    } else if($el.tagName === 'label') {

      continue;
      
    } else if($el.tagName === 'title') {

      html += this.title($el);

    } else {
      
      html += this.parse($el);
      
    }

  }
  
  html += '</section>';
  this.hLevel--;  

  return html;
};

Jats2Html.prototype.p = function($node){
  return this.map($node, 'p');
};

Jats2Html.prototype.sup = function($node){
  return this.map($node, 'sup');
};

Jats2Html.prototype.sub = function($node){
  return this.map($node, 'sub');
};

Jats2Html.prototype.bold = function($node){
  return this.map($node, 'strong');
};

Jats2Html.prototype.italic = function($node){
  return this.map($node, 'em');
};

Jats2Html.prototype.underline = function($node){
  return this.map($node, 'u');
};

Jats2Html.prototype.dispQuote = function($node){
  return this.map($node, 'blockquote');
};

Jats2Html.prototype.preformat = function($node){
  return this.map($node, 'pre');
};

Jats2Html.prototype.dispFormulaGroup = function($node){
  return this.map($node, 'div');
};

Jats2Html.prototype.fnGroup = function($node){
  return this.map($node, 'div');
};

Jats2Html.prototype.fn = function($node){
  return this.map($node, 'aside');
};

Jats2Html.prototype.boxedText = function($node){
  return this.map($node, 'div');
};


Jats2Html.prototype.floatGroup = function($node){
  return this.map($node, 'div');
};


Jats2Html.prototype.abbrev = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'title', value: $node.getAttribute('alt')}
  ];

  return this.map($node, 'abbr', attrList);
};


Jats2Html.prototype.hr = function($node){
  return this.selfClosingTag($node, 'hr');  
};


Jats2Html.prototype.break = function($node){
  return this.selfClosingTag($node, 'br');  
};

Jats2Html.prototype.xref = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'href', value: '#' + ($node.getAttribute('rid') || '') },
    {name: 'class', value: $node.getAttribute('ref-type')}
  ];

  return this.map($node, 'a', attrList);
};

Jats2Html.prototype.extLink = function($node){
  var html = '';

  var href = $node.getAttribute('xlink:href');
  if(href){
    href = isUrl(href) ? href: ('#' + href);
  }

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('ext-link-type')}
  ];

  if($node.childNodes.length && $node.childNodes.length) {

    html = this.map($node, 'a', attrList);
    
  } else {    

    html = this.openingTag($node, 'a', attrList);
    html += href || '';  
    html += '</a>';    

  }

  return html;
};


Jats2Html.prototype.uri = function($node){

  var href = $node.getAttribute('xlink:href');
  if(!href){
    href = ($node.textContent || '').trim();
  }
  href = isUrl(href) ? href: ('#' + href);  

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('xlink:type')}
  ];
  
  return this.map($node, 'a', attrList);     
};


Jats2Html.prototype.inlineSupplementaryMaterial = function($node){

  var href = $node.getAttribute('xlink:href');
  if(href){
    href = isUrl(href) ? href: ('#' + href);
  }

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('xlink:type')}
  ];
  
  return this.map($node, 'a', attrList);    
};


Jats2Html.prototype.inlineFormula = function($node){

  var html = this.openingTag($node, 'span', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: 'inline-formula'}
  ]);
  
  var $mathMl = $node.getElementsByTagName('mml:math')[0];
  var $texMath = $node.getElementsByTagName('tex-math')[0];
  var $inlineGraphic  = $node.getElementsByTagName('inline-graphic')[0];

  if($mathMl){
    
    html += this['mml:math']($mathMl);    

  } else if($texMath){

    html += this.texMath($texMath);    
    
  } else if($inlineGraphic) {

    html += this.inlineGraphic($inlineGraphic);    

  } else { //probably normal HTML...

    html += this._parse($node);    

  }

  html += '</span>';
  
  return html;
};


Jats2Html.prototype.dispFormula = function($node){
  
  var html = this.openingTag($node, 'div', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: 'disp-formula'}
  ]);

  for(var i=0; i<$node.childNodes.length; i++){

    var $el = $node.childNodes[i];
    if($el.nodeType === 3){

      html += $el.nodeValue;
      
    } else if($el.tagName === 'label') {

      html += this.openingTag($el, 'cite');
      html += $el.textContent;
      html += '</cite>';

    } else {
      
      html += this.parse($el);
      
    }

  }
  
  html += '</div>';

  return html;
};


Jats2Html.prototype.inlineGraphic = function($node){
  return this.selfClosingTag($node, 'img', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: 'inline-graphic'},
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


Jats2Html.prototype.graphic = function($node){
  return this.selfClosingTag($node, 'img', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


Jats2Html.prototype.texMath = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: 'latex'}
  ];

  return '<pre>' + this.map($node, 'code', attrList) + '</pre>';

};


Jats2Html.prototype['mml:math'] = function($node){
  
  Array.prototype.forEach.call($node.attributes, function(x){
    $node.removeAttribute(x.name);
  });

  $node.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');

  var s = new XMLSerializer();
  var html = s.serializeToString($node);
  return html.replace(/mml:/g, '');
};

Jats2Html.prototype.chemStruct = function($node){
  return this.map($node, 'div');    
};


Jats2Html.prototype.code = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: $node.getAttribute('code-type') || $node.getAttribute('language')}
  ];

  return '<pre>' + this.map($node, 'code', attrList) + '</pre>';
};


Jats2Html.prototype.list = function($node){
  var listType = $node.getAttribute('list-type');
  var tagName;

  if(listType === 'order' || 
     listType === 'alpha-lower' || 
     listType === 'alpha-upper' || 
     listType === 'roman-lower' || 
     listType === 'roman-upper') {
    tagName = 'ol';
  } else {
    tagName = 'ul';
  }

  var html = this.openingTag($node, tagName);

  var $listItems = $node.getElementsByTagName('list-item');
  if($listItems && $listItems.length){
    for(var i=0; i<$listItems.length; i++){
      html += this.openingTag($listItems[i], 'li');
      html += this._parse($listItems[i]);
      html += '</li>';
    }    
  }

  html += '</' + tagName + '>';
  
  return html;
};


Jats2Html.prototype.defList = function($node){

  var html = this.openingTag($node, 'dl');

  var i, j;

  var $defItems = $node.getElementsByTagName('def-item');
  if($defItems && $defItems.length){
    for(i=0; i<$defItems.length; i++){

      var $terms = $defItems[i].getElementsByTagName('term');
      if($terms && $terms.length){
        for(j=0; j<$terms.length; j++){
          html += this.openingTag($terms[j], 'dt');
          html += this._parse($terms[j]);
          html += '</dt>';          
        }        
      }

      var $defs = $defItems[i].getElementsByTagName('def');
      if($defs && $defs.length){
        for(j=0; j<$defs.length; j++){
          html += this.openingTag($defs[j], 'dd');
          html += this._parse($defs[j]);
          html += '</dd>';
        }
      }

    }
  }

  html += '</dl>';
  
  return html;
};


/**
 * helper to get <figcaption> or <caption>
 * $node is a node containing <label>, <caption> or <table-wrap-foot>
 */
Jats2Html.prototype._caption = function($node, tagName){

  var html = '';

  var $label = $node.getElementsByTagName('label')[0];
  var $caption = $node.getElementsByTagName('caption')[0];
  var $tableWrapFoot = $node.getElementsByTagName('tableWrapFoot')[0];

  if($label || $caption || $tableWrapFoot){
    html += this.openingTag($caption || $label || $tableWrapFoot, tagName);    
    
    var $title;
    if($caption){
      $title = $caption.getElementsByTagName('title')[0];      
    }

    if($label || $title){
      html += '<header>';    

      if($label){
        html += this.openingTag($label, 'cite'); 
        html += this._parse($label)
        html += '</cite>';      
      }

      if($title){
        html += this.openingTag($title, 'h3'); 
        html += this._parse($title)
        html += '</h3>';      
      }

      html += '</header>';    
    }

    if($caption){
      var $ps = $caption.getElementsByTagName('p');
      if($ps && $ps.length){
        for(var i=0; i<$ps.length; i++){
          html += this.p($ps[i]);
        }
      }
    }

    if($tableWrapFoot){
      html += this.tableWrapFoot($tableWrapFoot);    
    }

    html += '</' + tagName + '>';    
  }
  
  return html;
};

Jats2Html.prototype.tableWrapFoot = function($node){
  var html = this.openingTag($node, 'footer');    

  var content = '';
  var $label, $title;

  for(var i=0; i<$node.childNodes.length; i++){
    var $el = $node.childNodes[i];
    if($el.nodeType === 3){

      content += $el.nodeValue;

    } else if($el.tagName === 'label') {

      $label = $el;

    } else if($el.tagName === 'title') {

      $title = $el;
      
    } else {
      
      content += this.parse($el);
      
    }
  }

  if($label || $title){
    html += '<header>';

    if($label){
      html += this.openingTag($label, 'cite'); 
      html += this._parse($label)
      html += '</cite>';      
    }

    if($title){
      html += this.openingTag($title, 'h4'); 
      html += this._parse($title)
      html += '</h4>';
    }

    html += '</header>';
  }

  html += content;
  

  html += '</footer>';    

  return html;
};



/**
 * only figcaption, <img> <video> or <audio> will be added in JS
 */
Jats2Html.prototype.fig = function($node){

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');
  
  html += '</figure>';
  
  return html;
};


Jats2Html.prototype.figGroup = function($node){

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');

  var $figs = $node.getElementsByTagName('fig');
  if($figs && $figs.length){
    for(var i=0; i<$figs.length; i++){
      html += this.fig($figs[i]);    
    }
  }

  html += '</figure>';
  
  return html;
};


/**
 * only caption and <table>, <img> <video> or <audio> will be added in JS
 */
Jats2Html.prototype.tableWrap = function($node){

  var html = this.openingTag($node, 'table');

  html += this._caption($node, 'caption'); //also take into account table-wrap-foot

  var $table = $node.getElementsByTagName('table')[0];
  if($table){
    html += this.table($node);
  }

  html += '</table>';
  
  return html;
};

Jats2Html.prototype.tableWrapGroup = function($node){
  return this.map($node, 'div');
};


Jats2Html.prototype.supplementaryMaterial = function($node){

  var html = this.openingTag($node, 'aside');

  html += this._caption($node, 'div');
  
  html += '</aside>';
  
  return html;
};

Jats2Html.prototype.chemStructWrap = function($node){

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');
  
  html += '</figure>';
  
  return html;
};


/**
 * return the innerHTML of $node (table)
 */
Jats2Html.prototype.table = function($node){
  return this._parse($node);
};

Jats2Html.prototype.colgroup = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'bgcolor', value: $node.getAttribute('bgcolor')},
    {name: 'span', value: $node.getAttribute('span')},
    {name: 'width', value: $node.getAttribute('width')}
  ];

  return this.map($node, 'colgroup', attrList);
};


Jats2Html.prototype.col = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'bgcolor', value: $node.getAttribute('bgcolor')},
    {name: 'span', value: $node.getAttribute('span')}
  ];

  return this.map($node, 'col', attrList);
};


Jats2Html.prototype.thead = function($node){
  return this.map($node, 'thead');
};

Jats2Html.prototype.tbody = function($node){
  return this.map($node, 'tbody');
};

Jats2Html.prototype.tfoot = function($node){
  return this.map($node, 'tfoot');
};

Jats2Html.prototype.tr = function($node){
  return this.map($node, 'tr');
};

Jats2Html.prototype.th = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'th', attrList);
};

Jats2Html.prototype.td = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'td', attrList);
};


Jats2Html.prototype.ack = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'typeOf', value: 'http://purl.org/spar/deo/Acknowledgements'}
  ];

  return this.map($node, 'section', attrList);
};


Jats2Html.prototype.abstract = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'property', value: 'schema:about'}
  ];

  return this.map($node, 'section', attrList);
};


/**
 * mapping that should rarely be called (these elements are handled by higher level tags)
 * TODO improve
 */

Jats2Html.prototype.title = function($node){
  return this.map($node, 'h' + this.hLevel);
};

Jats2Html.prototype.label = function($node){
  return this.map($node, 'span');
};

Jats2Html.prototype.caption = function($node){
  return this.map($node, 'div');
};

Jats2Html.prototype.glossary = function($node){
  return this.map($node, 'section');
};


/**
 * id: the id of <ref-list>
 */
Jats2Html.prototype._citations2Html = function(){
  
  var html = (this.mainArticle.citation || [])
    .map(function(ref){
      var li = '';     
      
      li += this.openingTag(null, 'li', [
        {name: 'id', value: ref.name},
        {name: 'typeOf', value: ref['@type']},
        {name: 'property', value: 'schema:citation'},
      ]);


      var inlines = []; //all the inlines element will be join with ' '

      //label
      if(ref.alternateName){
        inlines.push('<span property="schema:alternateName">' + ref.alternateName + '</span>');
      }

      inlines.push(
        [ref.author].concat(ref.contributor)
          .filter(function(p){
            return p;
          })
          .map(function(p){
            var html = '<span typeOf="schema:Person">';

            if(p.givenName){
              html += '<span property="schema:givenName">' + p.givenName + '</span>';
            }
            if(p.familyName){
              html += ' <span property="schema:familyName">' + p.familyName + '</span>';
            }
            
            html += '</span>';

            return html;
          })
          .join(', ')
      );

      if(ref.unnamedContributors){
        inlines.push('<em property="pkg:unnamedContributors" content="true">et al.</em>');
      }

      if(ref.datePublished){
        inlines.push('<span property="schema:datePublished" content="'+ ref.datePublished +'">(' + (new Date(ref.datePublished)).getFullYear() + ')</span>');
      }

      if(ref.headline){
        inlines.push('<span property="schema:headline">' + ref.headline + '</span>');
      }

      if(ref.journal && ref.journal.name){
        inlines.push('<span typeOf="bibo:Journal"><span property="schema:name">' + ref.journal.name + '</span></span>');        
      }

      if(ref.volume !== undefined){
        inlines.push( '<span property="bibo:volume">' + ref.volume + '</span>' + ((ref.pages || ref.pageStart !== undefined)? ': ': '') );
      }

      if(ref.pages){
        inlines.push('<span property="bibo:pages">' + ref.pages + '</span>'); 
      } else if(ref.pageStart !== undefined){
        inlines.push('<span property="bibo:pageStart">' + ref.pageStart + '</span>' + ( (ref.pageEnd !== undefined)? '-<span property="bibo:pageEnd">' + ref.pageEnd + '</span>' : '') );
      }

      li += inlines.join(' ');
      li += '. ';      

      if(ref.doi || ref.pmid){
        li += '<ul>';
        if(ref.doi){
          li+= '<li><a property="bibo:doi" href="http://dx.doi.org/' + ref.doi + '">doi</a></li>';
        }
        if(ref.pmid){
          li+= '<li><a property="bibo:pmid" href="http://www.ncbi.nlm.nih.gov/pubmed/' + ref.pmid + '">PubMed</a></li>';
        }
        li += '</ul>';
      }

      li += '</li>';      
      
      return li;
    }, this)
    .join('');


  return this.openingTag(null, 'ul', [{name: 'typeOf', value:'http://purl.org/spar/doco/BibliographicReferenceList'}]) + html + '</ul>';
};

module.exports = Jats2Html;

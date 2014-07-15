var XMLSerializer = require('xmldom').XMLSerializer
  , isUrl = require('is-url');

function JatsBodyParser (ctx){
  this.ctx = ctx || {};
  this.hLevel = 1; //header level: increment for sections...
};

JatsBodyParser.prototype.parse = function($node){
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

JatsBodyParser.prototype._parse = function($node){
  var html = '';
  for(var i=0; i<$node.childNodes.length; i++){
    var $el = $node.childNodes[i];      
    html += this.parse($el);
  }

  return html;
};


JatsBodyParser.prototype.getAttr = function($node, attrList){

  attrList = attrList || [{name: 'id', value: $node.getAttribute('id')}, {name: 'typeOf', value: this.getRdfType($node)}];

  return attrList
    .filter(function(x) {return x.value;})  
    .map(function(x){
      return x.name + '="'+ x.value + '"';
    })
    .join(' ');  

};


JatsBodyParser.prototype.map = function($node, htmlTagName, attrList){
  var html = '';

  html += this.openingTag($node, htmlTagName, attrList);
  html += this._parse($node);  
  html += '</' + htmlTagName + '>';

  return html;  
};


JatsBodyParser.prototype.openingTag = function($node, htmlTagName, attrList){

  var attrs = this.getAttr($node, attrList);
  var oTag = '<' + htmlTagName;
  if(attrs){
    oTag += ' ' + attrs;
  }  
  oTag += '>';  

  return oTag;
};

JatsBodyParser.prototype.selfClosingTag = function($node, htmlTagName, attrList){

  var attrs = this.getAttr($node, attrList);
  var tag = '<' + htmlTagName;
  if(attrs){
    tag += ' ' + attrs;
  }  
  tag += ' />';  

  return tag;
};


JatsBodyParser.prototype.getRdfType = function($node){

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

JatsBodyParser.prototype.body = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'typeOf', value: 'http://schema.org/ScholarlyArticle'}
  ];

  return this.map($node, 'main', attrList);
};


JatsBodyParser.prototype.sec = function($node){
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

      html += this.openingTag($el, 'h'+ this.hLevel);
      html += $el.textContent;
      html += '</h' + this.hLevel + '>';

    } else {
      
      html += this.parse($el);
      
    }

  }
  
  html += '</section>';
  this.hLevel--;  

  return html;
};

JatsBodyParser.prototype.p = function($node){
  return this.map($node, 'p');
};

JatsBodyParser.prototype.sup = function($node){
  return this.map($node, 'sup');
};

JatsBodyParser.prototype.sub = function($node){
  return this.map($node, 'sub');
};

JatsBodyParser.prototype.bold = function($node){
  return this.map($node, 'strong');
};

JatsBodyParser.prototype.italic = function($node){
  return this.map($node, 'em');
};

JatsBodyParser.prototype.underline = function($node){
  return this.map($node, 'u');
};

JatsBodyParser.prototype.dispQuote = function($node){
  return this.map($node, 'blockquote');
};

JatsBodyParser.prototype.preformat = function($node){
  return this.map($node, 'pre');
};

JatsBodyParser.prototype.dispFormulaGroup = function($node){
  return this.map($node, 'div');
};

JatsBodyParser.prototype.fnGroup = function($node){
  return this.map($node, 'div');
};

JatsBodyParser.prototype.fn = function($node){
  return this.map($node, 'aside');
};

JatsBodyParser.prototype.boxedText = function($node){
  return this.map($node, 'div');
};

JatsBodyParser.prototype.abbrev = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'title', value: $node.getAttribute('alt')}
  ];

  return this.map($node, 'abbr', attrList);
};


JatsBodyParser.prototype.hr = function($node){
  return this.selfClosingTag($node, 'hr');  
};


JatsBodyParser.prototype.break = function($node){
  return this.selfClosingTag($node, 'br');  
};

JatsBodyParser.prototype.xref = function($node){

  var attrList = [
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'href', value: '#' + ($node.getAttribute('rid') || '') },
    {name: 'class', value: $node.getAttribute('ref-type')}
  ];

  return this.map($node, 'a', attrList);
};

JatsBodyParser.prototype.extLink = function($node){
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

  if($a.childNodes.length && $a.childNodes.length) {

    html = this.map($node, 'a', attrList);
    
  } else {    

    html = this.openingTag($node, 'a', attrList);
    html += href || '';  
    html += '</a>';    

  }

  return html;
};


JatsBodyParser.prototype.uri = function($node){

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


JatsBodyParser.prototype.inlineSupplementaryMaterial = function($node){

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


JatsBodyParser.prototype.inlineFormula = function($node){

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


JatsBodyParser.prototype.dispFormula = function($node){
  
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


JatsBodyParser.prototype.inlineGraphic = function($node){
  return this.selfClosingTag($node, 'img', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'class', value: 'inline-graphic'},
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


JatsBodyParser.prototype.graphic = function($node){
  return this.selfClosingTag($node, 'img', [ 
    {name: 'id', value: $node.getAttribute('id')},
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


JatsBodyParser.prototype.texMath = function($node){

  var html = this.openingTag($node, 'pre');
  html += '<code class="latex">';
  html += this._parse($node);    
  html += '</pre></code>';

  return html;
};


JatsBodyParser.prototype['mml:math'] = function($node){
  
  Array.prototype.forEach.call($node.attributes, function(x){
    $node.removeAttribute(x.name);
  });

  $node.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');

  var s = new XMLSerializer();
  var html = s.serializeToString($node);
  return html.replace(/mml:/g, '');
};

JatsBodyParser.prototype.chemStruct = function($node){
  return this.map($node, 'div');    
};



JatsBodyParser.prototype.list = function($node){
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


JatsBodyParser.prototype.defList = function($node){

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
JatsBodyParser.prototype._caption = function($node, tagName){

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

JatsBodyParser.prototype.tableWrapFoot = function($node){
  var html = this.openingTag($tableWrapFoot, 'footer');    

  var content = '';
  var $label, $title;

  for(var i=0; i<$node.childNodes.length; i++){
    var $el = node.childNodes[i];
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
JatsBodyParser.prototype.fig = function($node){

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');
  
  html += '</figure>';
  
  return html;
};


JatsBodyParser.prototype.figGroup = function($node){

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
JatsBodyParser.prototype.tableWrap = function($node){

  var html = this.openingTag($node, 'table');

  html += this._caption($node, 'caption'); //also take into account table-wrap-foot

  var $table = $node.getElementsByTagName('table')[0];
  if($table){
    html += this.table($node);
  }

  html += '</table>';
  
  return html;
};

JatsBodyParser.prototype.tableWrapGroup = function($node){
  return this.map($node, 'div');
};


JatsBodyParser.prototype.supplementaryMaterial = function($node){

  var html = this.openingTag($node, 'aside');

  html += this._caption($node, 'div');
  
  html += '</aside>';
  
  return html;
};

JatsBodyParser.prototype.chemStructWrap = function($node){

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');
  
  html += '</figure>';
  
  return html;
};


/**
 * return the innerHTML of $node (table)
 */
JatsBodyParser.prototype.table = function($node){
  return this._parse($node);
};

JatsBodyParser.prototype.thead = function($node){
  return this.map($node, 'thead');
};

JatsBodyParser.prototype.tbody = function($node){
  return this.map($node, 'tbody');
};

JatsBodyParser.prototype.tfoot = function($node){
  return this.map($node, 'tfoot');
};

JatsBodyParser.prototype.tr = function($node){
  return this.map($node, 'tr');
};

JatsBodyParser.prototype.th = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'th');
};

JatsBodyParser.prototype.td = function($node){
  var attrList = [
    {name: 'id', value: $node.getAttribute('id')}, 
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'td');
};


/**
 * mapping that should rarely be called (these elements are handled by higher level tags)
 * TODO improve
 */

JatsBodyParser.prototype.title = function($node){
  return this.map($node, 'h3');
};


JatsBodyParser.prototype.label = function($node){
  return this.map($node, 'span');
};

JatsBodyParser.prototype.caption = function($node){
  return this.map($node, 'div');
};

JatsBodyParser.prototype.abstract = function($node){
  return this.map($node, 'div');
};

module.exports = JatsBodyParser;

/**
 *
 *  RDFa: see http://rdfa.info/play/ pasting the following example to
 *  understand how @resource vs @about and @property vs @rel are used in
 *  the module.
 *
 *  TODO: find a way to remove the wrapper div for @typeof
 *
 *  <div resource="http://example.com#article">
 *    <div typeof="http://example.com/FrontMatter">
 *    <div about="http://example.com#article" rel="http://schema.org/image" >
 *      <div typeof="http://schema.org/ImageObject">
 *        <span property="http://schema.org/name">myname</span>
 *      </div>
 *    </div>
 *    </div>
 *  </div>
 *
 */

//TODO handle <alternatives>
//TODO write with handlebar templates
//TODO article.about

var XMLSerializer = require('xmldom').XMLSerializer
  , tools = require('./tools')
  , clone = require('clone')
  , packageJsonld = require('package-jsonld')
  , _ = require('underscore')
  , jats = require('./jats')
  , isUrl = require('is-url');

/**
 * Cf. http://jats.nlm.nih.gov/archiving/tag-library/1.1d1/index.html
 */

function Jats2Html (pkg, ctx) {
  this.pkg = packageJsonld.linkPackage(clone(pkg));
  this.ctx = ctx || {};
  this.hLevel = 1; //header level: increment for sections...

  this.mainArticle = this.pkg.article.filter(function(x) {
    if (!x['@type']) return false;
    var types = ( Array.isArray(x['@type']) )? x['@type']: [ x['@type'] ];
    return types.indexOf('ScholarlyArticle') !== -1 || types.indexOf('MedicalScholarlyArticle') !== -1;
  })[0];

  //used for RDFa @resource and @about
  this.pkgIRI = packageJsonld.BASE + this.pkg['@id'];
  this.articleIRI = packageJsonld.BASE + this.mainArticle['@id'];
};

Jats2Html.prototype.parse = function($node) {
  var html = '';

  if ($node.nodeType === 3) {
    html += _escape($node.nodeValue);
  } else if ($node.nodeType === 1) {
    var tagNameCamelCase = $node.tagName.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    if (tagNameCamelCase in this) {
      html += this[tagNameCamelCase]($node);
    } else {
      var s = new XMLSerializer();
      html += '<!--' + s.serializeToString($node) + '-->';
    }
  }

  return html;
};

Jats2Html.prototype._parse = function($node) {
  var html = '';
  for (var i=0; i<$node.childNodes.length; i++) {
    var $el = $node.childNodes[i];
    html += this.parse($el);
  }

  return html;
};

Jats2Html.prototype.getAttr = function($node, attrList) {
  attrList = attrList || [];

  //add id if not already there
  if ($node && !attrList.some(function(x) {return x.name === 'id';})) {
    attrList.push({name: 'id', value: $node.getAttribute('id')});
  }

  //try to add typeof if not already there
  if ($node && !attrList.some(function(x) {return x.name === 'typeof';})) {
    attrList.push({name: 'typeof', value: this.getSectionRdfType($node)});
  }

  return attrList
    .filter(function(x) {return x.value;})
    .map(function(x) {
      return x.name + '="'+ x.value + '"';
    })
    .join(' ');
};


Jats2Html.prototype.map = function($node, htmlTagName, attrList) {

  var html = this.openingTag($node, htmlTagName, attrList);
  html += this._parse($node);
  html += '</' + htmlTagName + '>';

  return html;
};


Jats2Html.prototype.openingTag = function($node, htmlTagName, attrList) {

  var attrs = this.getAttr($node, attrList);

  var oTag = '<' + htmlTagName;
  if (attrs) {
    oTag += ' ' + attrs;
  }
  oTag += '>';

  return oTag;
};

Jats2Html.prototype.selfClosingTag = function($node, htmlTagName, attrList) {

  var attrs = this.getAttr($node, attrList);
  var tag = '<' + htmlTagName;
  if (attrs) {
    tag += ' ' + attrs;
  }
  tag += ' />';

  return tag;
};


Jats2Html.prototype.getSectionRdfType = function($node) {

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
  Object.keys(deo).forEach(function(key) {
    deo[key + 's'] = deo[key];
  });

  var secType = $node.getAttribute('sec-type');
  var $title = $node.getElementsByTagName('title')[0];

  if (secType) {
    secType = secType.split('|'); // “sec-type="materials|methods"
  } else if ($title) {
    secType = $title.textContent.split(' ');
  }


  if (secType) {
    secType = secType.map(function(x) { return x.trim().toLowerCase(); });
    secType.forEach(function(t) {
      if (t in deo) {
        rdfTypes.push(deo[t]);
      }
    });
  }

  return rdfTypes.join(' ');
};


//All the tags...
Jats2Html.prototype.article = function($node) {

  var prefix = [
    'pkg: http://standardanalytics.io/package/',
    'schema: http://schema.org/',
    'deo: http://purl.org/spar/deo/',
    'salt: http://salt.semanticauthoring.org/documentation.html#',
    'bibo: http://purl.org/ontology/bibo/',
    'doco: http://purl.org/spar/doco/',
    "xsd: http://www.w3.org/2001/XMLSchema#"
  ];

  var meta = (this.pkg.keywords || [])
    .map(function(x) {
      return '<meta property="schema:keywords" content="' + x + '" />';
    });

  ['name', 'version'].forEach(function(x) {
    if (this.pkg[x]) {
      meta.push('<meta property="schema:' + x + '" content="' + this.pkg[x] + '" />');
    };
  }, this);

  ['doi', 'pmid', 'pmcid'].forEach(function(x) {
    if (this.mainArticle[x]) {
      meta.push('<meta property="schema:' + x + '" content="' + this.mainArticle[x] + '" />');
    };
  }, this);

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8" />',
    (this.mainArticle.headline) ? ('<title>' + this.mainArticle.headline + '</title>') : '',
    (this.pkg.keywords) ? ('<meta name="keywords" content="' + this.pkg.keywords.join(', ') + '" />') : '',
    '</head>',
    '<body prefix="' + prefix.join(' ') + '" resource="' + this.pkgIRI + '" typeof="pkg:Package" >',
    meta.join(''),
    this.map($node, 'article', [ //property of this.pkgIRI targeting this.articleIRI
      {name: 'property', value: 'pkg:article'},
      {name: 'resource', value: this.articleIRI},
      {name: 'typeof', value: _type(this.mainArticle['@type']) || 'Article'}
    ]),
    '</body>',
    '</html>'
  ].join('');

};


/**
 * abstract and permissions from the XML, all the rest from the package.jsonld
 */
Jats2Html.prototype.front = function($node) {

  var innerHtml = this._pkgMeta2Html() || '';

  var $permissions = $node.getElementsByTagName('permissions');
  if ($permissions && $permissions.length) {
    for (var i=0; i<$permissions.length; i++) {
      innerHtml += this.parse($permissions[i]);
    }
  }

  this.hLevel++;

  var $abstracts = $node.getElementsByTagName('abstract');
  if ($abstracts && $abstracts.length) {
    for (var i=0; i<$abstracts.length; i++) {
      innerHtml += this.parse($abstracts[i]);
    }
  }

  this.hLevel--;

  var attrList = [
    {name: 'typeof', value: 'doco:FrontMatter'}
  ];

  return (innerHtml)? (this.openingTag($node, 'section', attrList) + innerHtml + '</section>') : '';

};


Jats2Html.prototype._pkgMeta2Html = function() {
  var html = '';

  if (this.mainArticle.headline) {
    html += '<h1 property="schema:headline" about="' + this.articleIRI + '" >' + this.mainArticle.headline + '</h1>';
  }

  var datePublished = this.mainArticle.datePublished || this.pkg.datePublished;
  if (datePublished) {
    html += '<span property="schema:datePublished" content="' + datePublished + '" about="' + this.articleIRI + '" >' + (new Date(datePublished)).toDateString() + '</span>';
  }

  var authors = [ this.mainArticle.author || this.pkg.author ].concat(this.mainArticle.contributor || this.pkg.contributor);
  if (authors.some(function(x) {return x;})) {
    html += '<ul>';
    html += authors.map(this._personOrOrganizationLi('schema:author', 'schema:contributor'), this).join('');
    html += '</ul>';
  }

  var accountablePerson = this.mainArticle.accountablePerson || this.pkg.accountablePerson;
  if (accountablePerson) {
    html += 'Accountable Person' + ((accountablePerson.length>1)? 's': '') + ': ';
    html += '<ul>';
    html += accountablePerson.map(this._personOrOrganizationLi('schema:accountablePerson'), this).join('');
    html += '</ul>';
  }

  var editor = this.mainArticle.editor || this.pkg.editor;
  if (editor) {
    html += 'Editor' + ((editor.length>1)? 's': '') + ': ';
    html += '<ul>';
    html += editor.map(this._personOrOrganizationLi('schema:editor'), this).join('');
    html += '</ul>';
  }

  return html;
};


/**
 * Also work for organization
 */
Jats2Html.prototype._personOrOrganizationLi = function(prop0, prop) {

  prop = prop || prop0;
  var pkgIRI = this.pkgIRI;

  return function(personOrOrganization, i) {
    var li = '';

    if (personOrOrganization) {
      li += '<li rel="' + ((i===0) ? prop0: prop) + '" about="' + pkgIRI + '" >'; //TODO: about="this.articleIRI" ???
      li += '<div typeof="'+ _type(personOrOrganization['@type']) + '">'; //TODO find a way to avoid wrapper div
      if (personOrOrganization.email) {
        li += '<a property="email" href="'+ personOrOrganization.email +'">';
      }

      if (personOrOrganization['@type'] === 'Person') {
        li += ['givenName', 'familyName'].filter(function(x) {return x in personOrOrganization;}).map(function(p) {
          return '<span property="schema:' + p + '">' + personOrOrganization[p] + '</span> ';
        }).join(' ');
      } else if (personOrOrganization.name) { //works for Organization
        li += '<span property="schema:name">' + personOrOrganization.name + '</span> ';
      }

      if (personOrOrganization.email) {
        li += '</a>';
      }
      if (personOrOrganization.affiliation) {
        li += '<ul rel="schema:affiliation">';
        li += personOrOrganization.affiliation.map(function(affiliation) {
          var ulli = '<li  typeof="' + _type(affiliation['@type']) + '">';
          ulli += '<span property="schema:description">' + affiliation.description + '</span>';
          ulli += '</li>';
          return ulli;
        }).join('');
        li += '</ul>';
      }

      li += '</div>';
      li += '</li>';
    }

    return li;
  };

};


Jats2Html.prototype.back = function($node) {

  var innerHtml = ''
  this.hLevel++;

  for (var i=0; i<$node.childNodes.length; i++) {
    var $el = $node.childNodes[i];
    if ($el.nodeType === 3) {

      innerHtml += _escape($el.nodeValue);

    } else if ($el.tagName === 'ref-list') {

      innerHtml += this.openingTag($el, 'section', [
        { name: 'typeof', value: 'doco:Bibliography'}
      ]);

      innerHtml += this._citations2Html();
      innerHtml += '</section>';

    } else {

      innerHtml += this.parse($el);

    }

  }

  this.hLevel--;

  var attrList = [
    {name: 'typeof', value: 'doco:BackMatter'}
  ];

  return (innerHtml)? (this.openingTag($node, 'section', attrList) + innerHtml + '</section>') : '';

};


Jats2Html.prototype.body = function($node) {

  var attrList = [
    {name: 'property', value: 'schema:articleBody'},
    {name: 'about', value: this.articleIRI}
  ];

  return this.map($node, 'section', attrList);
};

Jats2Html.prototype.sec = function($node) {
  var html = '';

  this.hLevel++;
  html += this.openingTag($node, 'section');

  for (var i=0; i<$node.childNodes.length; i++) {
    var $el = $node.childNodes[i];
    if ($el.nodeType === 3) {

      html += _escape($el.nodeValue);

    } else if ($el.tagName === 'label') {

      continue;

    } else if ($el.tagName === 'title') {

      html += this.title($el);

    } else {

      html += this.parse($el);

    }

  }

  html += '</section>';
  this.hLevel--;

  return html;
};

Jats2Html.prototype.p = function($node) {
  return this.map($node, 'p');
};

Jats2Html.prototype.sup = function($node) {
  return this.map($node, 'sup');
};

Jats2Html.prototype.sub = function($node) {
  return this.map($node, 'sub');
};

Jats2Html.prototype.bold = function($node) {
  return this.map($node, 'strong');
};

Jats2Html.prototype.italic = function($node) {
  return this.map($node, 'em');
};

Jats2Html.prototype.underline = function($node) {
  return this.map($node, 'u');
};

Jats2Html.prototype.dispQuote = function($node) {
  return this.map($node, 'blockquote');
};

Jats2Html.prototype.preformat = function($node) {
  return this.map($node, 'pre');
};

Jats2Html.prototype.dispFormulaGroup = function($node) {
  return this.map($node, 'div');
};

Jats2Html.prototype.textualForm = function($node) {
  return this.map($node, 'span');
};

Jats2Html.prototype.fnGroup = function($node) {
  return this.map($node, 'div');
};

Jats2Html.prototype.fn = function($node) {
  return this.map($node, 'aside');
};

Jats2Html.prototype.boxedText = function($node) {
  return this.map($node, 'div');
};


Jats2Html.prototype.floatGroup = function($node) {
  return this.map($node, 'div');
};


Jats2Html.prototype.abbrev = function($node) {
  var attrList = [
    {name: 'title', value: $node.getAttribute('alt')}
  ];

  return this.map($node, 'abbr', attrList);
};


Jats2Html.prototype.hr = function($node) {
  return this.selfClosingTag($node, 'hr');
};


Jats2Html.prototype.break = function($node) {
  return this.selfClosingTag($node, 'br');
};

Jats2Html.prototype.xref = function($node) {

  var attrList = [
    {name: 'href', value: '#' + ($node.getAttribute('rid') || '') },
    {name: 'class', value: $node.getAttribute('ref-type')}
  ];

  return this.map($node, 'a', attrList);
};

Jats2Html.prototype.extLink = function($node) {
  var html = '';

  var href = $node.getAttribute('xlink:href');
  if (href) {
    href = isUrl(href) ? href: ('#' + href);
  }

  var attrList = [
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('ext-link-type')}
  ];

  if ($node.childNodes.length && $node.childNodes.length) {

    html = this.map($node, 'a', attrList);

  } else {

    html = this.openingTag($node, 'a', attrList);
    html += href || '';
    html += '</a>';

  }

  return html;
};


Jats2Html.prototype.uri = function($node) {

  var href = $node.getAttribute('xlink:href');
  if (!href) {
    href = ($node.textContent || '').trim();
  }
  href = isUrl(href) ? href: ('#' + href);

  var attrList = [
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('xlink:type')}
  ];

  return this.map($node, 'a', attrList);
};


Jats2Html.prototype.inlineSupplementaryMaterial = function($node) {

  var href = $node.getAttribute('xlink:href');
  if (href) {
    href = isUrl(href) ? href: ('#' + href);
  }

  var attrList = [
    {name: 'href', value: href },
    {name: 'title', value: $node.getAttribute('xlink:title') },
    {name: 'class', value: $node.getAttribute('xlink:type')}
  ];

  return this.map($node, 'a', attrList);
};


Jats2Html.prototype.inlineFormula = function($node) {

  var html = this.openingTag($node, 'span', [
    {name: 'class', value: 'inline-formula'}
  ]);

  var $mathMl = $node.getElementsByTagName('mml:math')[0];
  var $texMath = $node.getElementsByTagName('tex-math')[0];
  var $inlineGraphic  = $node.getElementsByTagName('inline-graphic')[0];

  if ($mathMl) {

    html += this['mml:math']($mathMl);

  } else if ($texMath) {

    html += this.texMath($texMath);

  } else if ($inlineGraphic) {

    html += this.inlineGraphic($inlineGraphic);

  } else { //probably normal HTML...

    html += this._parse($node);

  }

  html += '</span>';

  return html;
};


Jats2Html.prototype.dispFormula = function($node) {

  var html = this.openingTag($node, 'div', [
    {name: 'class', value: 'disp-formula'}
  ]);

  for (var i=0; i<$node.childNodes.length; i++) {

    var $el = $node.childNodes[i];
    if ($el.nodeType === 3) {

      html += _escape($el.nodeValue);

    } else if ($el.tagName === 'label') {

      html += this.openingTag($el, 'cite');
      html += _escape($el.textContent);
      html += '</cite>';

    } else {

      html += this.parse($el);

    }

  }

  html += '</div>';

  return html;
};

Jats2Html.prototype.inlineGraphic = function($node) {
  return this.selfClosingTag($node, 'img', [
    {name: 'class', value: 'inline-graphic'},
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


Jats2Html.prototype.graphic = function($node) {
  return this.selfClosingTag($node, 'img', [
    {name: 'src', value: this.ctx[$node.getAttribute('xlink:href')]}
  ]);
};


Jats2Html.prototype.texMath = function($node) {
  var attrList = [
    {name: 'class', value: 'latex'}
  ];

  return '<pre>' + this.map($node, 'code', attrList) + '</pre>';
};


Jats2Html.prototype['mml:math'] = function($node) {

  Array.prototype.forEach.call($node.attributes, function(x) {
    $node.removeAttribute(x.name);
  });

  $node.setAttribute('xmlns', 'http://www.w3.org/1998/Math/MathML');

  var s = new XMLSerializer();
  var html = s.serializeToString($node);
  return html.replace(/mml:/g, '');
};

Jats2Html.prototype.chemStruct = function($node) {
  return this.map($node, 'div');
};


Jats2Html.prototype.code = function($node) {

  var attrList = [
    {name: 'class', value: $node.getAttribute('code-type') || $node.getAttribute('language')}
  ];

  return '<pre>' + this.map($node, 'code', attrList) + '</pre>';
};


Jats2Html.prototype.list = function($node) {
  var listType = $node.getAttribute('list-type');
  var tagName;

  if (listType === 'order' ||
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
  if ($listItems && $listItems.length) {
    for (var i=0; i<$listItems.length; i++) {
      html += this.openingTag($listItems[i], 'li');
      html += this._parse($listItems[i]);
      html += '</li>';
    }
  }

  html += '</' + tagName + '>';

  return html;
};


Jats2Html.prototype.defList = function($node) {

  var html = this.openingTag($node, 'dl');

  var i, j;

  var $defItems = $node.getElementsByTagName('def-item');
  if ($defItems && $defItems.length) {
    for (i=0; i<$defItems.length; i++) {

      var $terms = $defItems[i].getElementsByTagName('term');
      if ($terms && $terms.length) {
        for (j=0; j<$terms.length; j++) {
          html += this.openingTag($terms[j], 'dt');
          html += this._parse($terms[j]);
          html += '</dt>';
        }
      }

      var $defs = $defItems[i].getElementsByTagName('def');
      if ($defs && $defs.length) {
        for (j=0; j<$defs.length; j++) {
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
Jats2Html.prototype._caption = function($node, tagName, attrList, mainTypedResource) {

  var html = '';

  var $label = $node.getElementsByTagName('label')[0];
  var $caption = $node.getElementsByTagName('caption')[0];
  var $tableWrapFoot = $node.getElementsByTagName('table-wrap-foot')[0];

  if ($label || $caption || $tableWrapFoot) {
    html += this.openingTag($caption || $label || $tableWrapFoot, tagName, attrList);

    if(mainTypedResource && mainTypedResource.value && mainTypedResource.value.name){
      html += '<meta property="schema:name" content="' + mainTypedResource.value.name + '" />';
    }

    var $title;
    if ($caption) {
      $title = $caption.getElementsByTagName('title')[0];
    }

    if ($label || $title) {
      html += '<header>';

      if ($label) {
        html += this.openingTag($label, 'cite', [
          {name: 'property', value: mainTypedResource && 'schema:alternateName'} //only if mainTypedResource (if value === undefined => no property)
        ]);
        html += this._parse($label)
        html += '</cite>';
      }

      if ($title) {
        html += this.openingTag($title, 'h3', [
          {name: 'property', value: mainTypedResource && 'schema:headline'}
        ]);
        html += this._parse($title)
        html += '</h3>';
      }

      html += '</header>';
    }

    if ($caption) {
      var $ps = $caption.getElementsByTagName('p');
      if ($ps && $ps.length) {
        if(mainTypedResource) {
          html += '<div property="schema:' + ((tagName === 'figcaption')? 'caption': 'description') + '">';
        }
        for (var i=0; i<$ps.length; i++) {
          html += this.p($ps[i]);
        }
        if(mainTypedResource) {
          html += '</div>';
        }
      }
    }

    if ($tableWrapFoot) {
      html += this.tableWrapFoot($tableWrapFoot, mainTypedResource);
    }

    html += '</' + tagName + '>';
  }

  return html;
};

Jats2Html.prototype.tableWrapFoot = function($node, mainTypedResource) {

  var content = '';
  var $label, $title;

  for (var i=0; i<$node.childNodes.length; i++) {
    var $el = $node.childNodes[i];
    if ($el.nodeType === 3) {

      content += _escape($el.nodeValue);

    } else if ($el.tagName === 'label') {

      $label = $el;

    } else if ($el.tagName === 'title') {

      $title = $el;

    } else {

      content += this.parse($el);

    }
  }

  var attrList = [];
  if (mainTypedResource) {
    attrList.push(
      {name: 'rel', value: 'schema:comment'},
      {name: 'about', value: (packageJsonld.BASE + mainTypedResource.value['@id'])}
    );
  }

  var html = this.openingTag($node, 'footer', attrList);

  if (mainTypedResource) {
    html += '<div typeof="schema:Comment">';
  }

  if ($label || $title) {
    html += '<header>';

    if ($label) {
      html += this.map($label, 'cite', [
        {name: 'property', value: mainTypedResource && 'schema:alternateName'}
      ]);
    }

    if ($title) {
      html += this.map($title, 'h4', [
        {name: 'property', value: mainTypedResource && 'schema:headline'}
      ]);
    }

    html += '</header>';
  }

  if (mainTypedResource) {
    html += '<div property="schema:text">';
  }
  html += content;
  if (mainTypedResource) {
    html += '</div>';
    html += '</div>'; //close typeof schema:Comment
  }
  html += '</footer>';

  return html;
};


Jats2Html.prototype.fig = function($node, htmlToInsertBeforeEnd) {

  var typedResources = this._typedResources($node);

  var attrList = [];

  if (typedResources.main && typedResources.main.value) {
    attrList.push(
      {name: 'about', value: this.pkgIRI},
      {name: 'rel', value: typedResources.main.type}
    );
  }

  var html = this.openingTag($node, 'figure', attrList);

  html += this._link(typedResources.all);

  html += this._thumbnail(typedResources.all);

  //!! <figcaption> HAS to be direct child of <figure>
  var rdfResourceAttrList = [
    {name: 'resource', value: typedResources.main.value['@id'] && (packageJsonld.BASE + typedResources.main.value['@id']) },
    {name: 'typeof', value:  _type(typedResources.main.value['@type'] || 'ImageObject') }
  ];
  html += this._caption($node, 'figcaption', rdfResourceAttrList, typedResources.main);

  if (htmlToInsertBeforeEnd) {
    html += htmlToInsertBeforeEnd;
  }

  html += '</figure>';

  return html;
};


Jats2Html.prototype.figGroup = function($node) {

  var innerHtml = '';
  var $figs = $node.getElementsByTagName('fig');
  if ($figs && $figs.length) {
    for (var i=0; i<$figs.length; i++) {
      innerHtml += this.fig($figs[i]);
    }
  }

  return this.fig($node, innerHtml);
};


/**
 * only caption and <table>, <img> <video> or <audio> will be added in JS
 */
Jats2Html.prototype.tableWrap = function($node) {

  var typedResources = this._typedResources($node);

  var attrList = [];
  if (typedResources.main && typedResources.main.value) {
    attrList.push(
      {name: 'about', value: this.pkgIRI},
      {name: 'rel', value: typedResources.main.type}
    );
  }

  //<link> cannot be within <table> so we wrap everything in a <div>
  var html = this.openingTag($node, 'div', attrList);

  if (typedResources.main && typedResources.main.value) {
    html += this.openingTag(null, 'table', [
      {name: 'resource', value: typedResources.main.value['@id'] && (packageJsonld.BASE + typedResources.main.value['@id']) },
      {name: 'typeof', value:  _type(typedResources.main.value['@type'] || 'Dataset') }
    ]);
  } else {
    html += '<table>';
  }

  html += this._caption($node, 'caption', null, typedResources.main); //also take into account table-wrap-foot

  var $table = $node.getElementsByTagName('table')[0];
  if ($table) {
    html += this.table($table);
  }

  html += '</table>';

  html += this._link(typedResources.all);

  html += '</div>';

  return  html;
};

Jats2Html.prototype.tableWrapGroup = function($node) {
  return this.map($node, 'div');
};


Jats2Html.prototype.supplementaryMaterial = function($node) {
  var typedResources = this._typedResources($node);

  var attrList = [];

  if (typedResources.main && typedResources.main.value) {
    attrList.push(
      {name: 'about', value: this.pkgIRI},
      {name: 'rel', value: typedResources.main.type}
    );
  }

  var html = this.openingTag($node, 'aside', attrList); //TODO <figure> instead of <aside>
  html += this._link(typedResources.all);
  html += this._thumbnail(typedResources.all);

  var rdfResourceAttrList = [
    {name: 'resource', value: typedResources.main.value['@id'] && (packageJsonld.BASE + typedResources.main.value['@id']) },
    {name: 'typeof', value:  _type(typedResources.main.value['@type'] || 'ImageObject') }
  ];
  html += this._caption($node, 'div', rdfResourceAttrList, typedResources.main);

  html += '</aside>';

  return html;
};


Jats2Html.prototype.chemStructWrap = function($node) {

  var html = this.openingTag($node, 'figure');

  html += this._caption($node, 'figcaption');

  html += '</figure>';

  return html;
};


/**
 * return the innerHTML of $node (table)
 */
Jats2Html.prototype.table = function($node) {
  return this._parse($node);
};

Jats2Html.prototype.colgroup = function($node) {
  var attrList = [
    {name: 'bgcolor', value: $node.getAttribute('bgcolor')},
    {name: 'span', value: $node.getAttribute('span')},
    {name: 'width', value: $node.getAttribute('width')}
  ];

  return this.map($node, 'colgroup', attrList);
};


Jats2Html.prototype.col = function($node) {
  var attrList = [
    {name: 'bgcolor', value: $node.getAttribute('bgcolor')},
    {name: 'span', value: $node.getAttribute('span')}
  ];

  return this.selfClosingTag($node, 'col', attrList);
};


Jats2Html.prototype.thead = function($node) {
  return this.map($node, 'thead');
};

Jats2Html.prototype.tbody = function($node) {
  return this.map($node, 'tbody');
};

Jats2Html.prototype.tfoot = function($node) {
  return this.map($node, 'tfoot');
};

Jats2Html.prototype.tr = function($node) {
  return this.map($node, 'tr');
};

Jats2Html.prototype.th = function($node) {
  var attrList = [
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'th', attrList);
};

Jats2Html.prototype.td = function($node) {
  var attrList = [
    {name: 'colspan', value: $node.getAttribute('colspan')},
    {name: 'headers', value: $node.getAttribute('headers')},
    {name: 'rowspan', value: $node.getAttribute('rowspan')}
  ];

  return this.map($node, 'td', attrList);
};


Jats2Html.prototype.ack = function($node) {
  var attrList = [
    {name: 'typeof', value: 'http://purl.org/spar/deo/Acknowledgements'}
  ];

  return this.map($node, 'section', attrList);
};


Jats2Html.prototype.abstract = function($node) {
  var attrList = [
    {name: 'rel', value: 'schema:abstract'},
    {name: 'about', value: this.articleIRI}
  ];

  var html = this.openingTag($node, 'section', attrList);
  html += '<div typeof="schema:Abstract" >' ;//TODO get rid of wrapper div
  //easy cases: basic unstructured abstract with optional <p> and <title> (and that only)
  if ($node.childNodes.length <= 2 &&
     Array.prototype.every.call($node.childNodes, function($el) { return $el.tagName === 'p' || $el.tagName === 'title'; })
    ) {

    Array.prototype.forEach.call($node.childNodes, function($el) {
      html += this.map($el, ($el.tagName === 'p')? 'p': ('h' + this.hLevel) , [
        {name: 'property', value: ($el.tagName === 'p')? 'schema:abstractBody': 'schema:headline'}
      ]);
    }.bind(this));

  } else {

    var isStructured = Array.prototype.some.call($node.childNodes, function($el) {
      return $el.tagName === 'sec';
    });

    if (!isStructured) { //add a wrapper div
      html += '<div property="schema:abstractBody">';
    }

    for (var i=0; i<$node.childNodes.length; i++) {
      var $el = $node.childNodes[i];
      if ($el.nodeType === 3) {
        html += _escape($el.nodeValue);
      } else if ($el.tagName === 'sec') {
        html += this._abstractPart($el);
      } else {
        html += this.parse($el);
      }
    }

    if (!isStructured) {
      html += '</div>';
    }

  }

  html += '</div>';
  html += '</section>';

  return html;

};



Jats2Html.prototype._abstractPart = function($sec) {

  var attrList = [
    {name: 'typeof', value: 'schema:Abstract'},
    {name: 'property', value: 'schema:hasPart'}
  ];

  var html = this.openingTag($sec, 'section', attrList);

  this.hLevel++;

  //easy case: 1 <title> and or 1 <p> only"
  if ($sec.childNodes &&
     $sec.childNodes.length <= 2 &&
     Array.prototype.every.call($sec.childNodes, function($el) { return $el.tagName === 'p' || $el.tagName === 'title'; })
    ) {

    Array.prototype.forEach.call($sec.childNodes, function($el) {
      html += this.map($el, ($el.tagName === 'p')? 'p': ('h' + this.hLevel) , [
        {name: 'property', value: ($el.tagName === 'p')? 'schema:abstractBody': 'schema:headline'}
      ]);
    }.bind(this));

  } else { //more tricky case, we mark the title (if any and if first child) as schema:headline and we wrap all that follows in a <div property="abstractBody">

    for (var i=0; i<$sec.childNodes.length; i++) {
      var $el = $sec.childNodes[i];
      if ($el.nodeType === 3) {
        html += _escape($el.nodeValue);
      } else if ($el.tagName === 'title') {

        html += this.map($el, 'h' + this.hLevel, [
          {name: 'property', value: 'schema:headline'}
        ]);

        //open wrapper div for abstractBody
        html += '<div property="abstractBody">';

      } else {
        html += this.parse($el);
      }
    }

    html += '</div>'; // close wrapper div for abstractBody

  }

  this.hLevel--;

  html += '</section>';

  return html;
};

/**
 * mapping that should rarely be called (these elements are handled by higher level tags)
 * TODO improve
 */

Jats2Html.prototype.title = function($node) {
  return this.map($node, 'h' + this.hLevel);
};

Jats2Html.prototype.label = function($node) {
  return this.map($node, 'span');
};

Jats2Html.prototype.caption = function($node) {
  return this.map($node, 'div');
};

Jats2Html.prototype.glossary = function($node) {
  return this.map($node, 'section');
};

Jats2Html.prototype.permissions = function($node) {
  return this.map($node, 'section');
};

Jats2Html.prototype.copyrightStatement = function($node) {
  return this.map($node, 'p');
};

Jats2Html.prototype.copyrightYear = function($node) {
  return this.selfClosingTag($node, 'meta', [
    { name: 'about', value: this.pkgIRI },
    { name: 'property', value: 'schema:copyrightYear' },
    { name: 'content', value: tools.cleanText($node.textContent) }
  ]);
};

Jats2Html.prototype.copyrightHolder = function($node) {
  var html = '<div about="' + this.pkgIRI + '"  rel="schema:copyrightHolder" >';

  html += this.selfClosingTag($node, 'meta', [
    { name: 'typeof', value: 'schema:Organization' }, //TODO find a way to assess if Organization or Person
    { name: 'property', value: 'schema:name' }, //TODO should it be description instead of name ??
    { name: 'content', value: tools.cleanText($node.textContent) }
  ]);

  html += '</div>'

  return html;
};

Jats2Html.prototype.license = function($node) {

  var html;

  var href = $node.getAttribute('xlink:href');
  if (href) {

    html = this.map($node, 'section', [
      { name: 'about', value: this.pkgIRI },
      { name: 'property', value: 'schema:license' },
      { name: 'content', value: href }
    ]);

    //TODO ? use <link rel="license" href="..." /> instead of tagging <section> Cf. https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types
  } else {

    html = this.openingTag($node, 'section', [
      { name: 'about', value: this.pkgIRI },
      { name: 'rel', value: 'schema:license' }
    ]);

    html += '<div typeof="schema:CreativeWork">';

    //<license can only have one or more <license-p> childs, nothing else
    var $licenseP = $node.getElementsByTagName('license-p');
    if ($licenseP && $licenseP.length) {
      if ($licenseP.length === 1) {
        html += this.licenseP($licenseP[0], [{name: 'property', value: 'schema:text'}]);
      } else { //need a wrapper div
        html += '<div property="schema:text">';
        html += this._parse($node);
        html += '</div>';
      }
    }

    html += '</div>'; //close typeof:CreativeWork
    html += '</section>';
  }

  return html;
};

Jats2Html.prototype.licenseP = function($node, attrList) {
  return this.map($node, 'p', attrList);
};


/**
 * id: the id of <ref-list>
 */
Jats2Html.prototype._citations2Html = function() {

  var html = (this.mainArticle.citation || []).map(function(ref) {
    var li = '';

    li += this.openingTag(null, 'li', [
      {name: 'id', value: ref.name},
      {name: 'rel', value: 'schema:citation'},
      {name: 'about', value: this.articleIRI},
    ]);

    li += '<div typeof="' + (_type(ref['@type']) || 'Article') + '" >';

    var inlines = []; //all the inlines element will be join with ' '

    //label
    if (ref.alternateName) {
      inlines.push('<span property="schema:alternateName">' + ref.alternateName + '</span>');
    }

    function personOrOrganizationSpan(p, prop) {

      var html = '<span property="' + prop + '" typeof="' + (_type(p['@type']) || 'schema:Person') + '">';

      if (p.familyName || p.givenName) {
        if (p.familyName) {
          html += '<span property="schema:familyName">' + p.familyName + '</span>';
        }
        if (p.givenName) {
          if (p.familyName) html += ' ';
          html += '<span property="schema:givenName">' + p.givenName + '</span>';
        }
      } else {
        if (p.name) {
          html += '<span property="schema:name">' + p.name + '</span>';
        }
      }

      html += '</span>';

      return html;
    };

    var allAuthors = [];
    if (ref.author) {
      allAuthors.push(personOrOrganizationSpan(ref.author, 'schema:author'));
    }
    if (ref.contributor) {
      allAuthors = allAuthors.concat(ref.contributor.map(function(x) {
        return personOrOrganizationSpan(x, 'schema:contributor');
      }));
    }

    if (allAuthors.length) {
      inlines.push(allAuthors.join(', '));
    }

    if (ref.unnamedContributors) {
      inlines.push('<em property="pkg:unnamedContributors" content="true">et al.</em>');
    }

    if (ref.datePublished) {
      inlines.push('<span property="schema:datePublished" content="'+ ref.datePublished +'">(' + (new Date(ref.datePublished)).getFullYear() + ')</span>');
    }

    if (ref.headline) {
      inlines.push('<span property="schema:headline">' + ref.headline + '</span>');
    }

    // issue, volume and periodical, we want smtg like:
    // <!-- Archives of internal medicine 169 (4) :335-341 -->
    // <div vocab="http://schema.org/" typeof="MedicalScholarlyArticle">
    //   <span property="isPartOf" typeof="PublicationIssue">
    //     <span property="isPartOf" typeof="PublicationVolume">
    //       <span property="isPartOf" typeof="Periodical">
    //         <span property="alternateName">Arch. Intern. Med.</span>
    //         <meta property="name" content="Archives of internal medicine"/>
    //       </span>
    //       <span property="volumeNumber">169</span>
    //     </span>
    //     (<span property="issueNumber">4</span>)
    //   </span>
    //   :<span property="pageStart">335</span>-<span property="pageEnd">341</span>
    // </div>
    var periodicalHtml, volumeHtml, issueHtml, pagesHtml;
    if (ref.isPartOf) {

      var periodical = _getPartOf(ref.isPartOf, 'Periodical');
      var volume = _getPartOf(ref.isPartOf, 'PublicationVolume');
      var issue = _getPartOf(ref.isPartOf, 'PublicationIssue');

      if (periodical && (periodical.name || periodical.alternateName)) {
        periodicalHtml = '<span property="schema:isPartOf" typeof="schema:Periodical">';
        if (periodical.alternateName) {
          periodicalHtml += '<span property="schema:alternateName">' + periodical.alternateName + '</span>';
          if (periodical.name) {
            periodicalHtml += '<meta property="schema:name" content="' + periodical.name + '" />';
          }
        } else {
          periodicalHtml += '<span property="schema:name">' + periodical.name + '</span>';
        }
        periodicalHtml += '</span>';
      }

      if (volume && volume.volumeNumber !== undefined) {
        volumeHtml = '<span property="schema:isPartOf" typeof="schema:PublicationVolume">';
        if (periodicalHtml) {
          volumeHtml += periodicalHtml + ' ';
        }
        volumeHtml += '<span property="schema:volumeNumber">' + volume.volumeNumber + '</span>';
        volumeHtml += '</span>';
      }

      if (issue && issue.issueNumber !== undefined) {
        issueHtml = '<span property="schema:isPartOf" typeof="schema:PublicationIssue">';
        issueHtml += volumeHtml || periodicalHtml || '';
        issueHtml += '(<span property="bibo:issue">' + issue.issueNumber + '</span>)';
        issueHtml += '</span>';
      }

    }

    if (ref.pagination || ref.pageStart !== undefined) {
      pagesHtml = (volumeHtml || issueHtml) ? ':' :  ((periodicalHtml) ?  ' ': '');
      if (ref.pagination) {
        pagesHtml += '<span property="schema:pagination">' + ref.pagination + '</span>';
      } else if (ref.pageStart !== undefined) {
        pagesHtml += '<span property="schema:pageStart">' + ref.pageStart + '</span>' + ( (ref.pageEnd !== undefined)? ('-<span property="schema:pageEnd">' + ref.pageEnd + '</span>') : '');
      }
    }

    inlines.push((issueHtml || volumeHtml || periodicalHtml || '') + (pagesHtml || '') );

    li += inlines.join(' ');
    li += '. ';

    if(ref.comment && ref.comment.text){
      li += ref.comment.text;
    }

    if (ref.doi || ref.pmid) {
      li += '<ul>';
      if (ref.doi) {
        li+= '<li><a property="bibo:doi" href="http://dx.doi.org/' + ref.doi + '">doi</a></li>';
      }
      if (ref.pmid) {
        li+= '<li><a property="bibo:pmid" href="http://www.ncbi.nlm.nih.gov/pubmed/' + ref.pmid + '">PubMed</a></li>';
      }
      li += '</ul>';
    }

    li += '</div>';
    li += '</li>';

    return li;

  }, this).join('');

  return this.openingTag(null, 'ul', [{name: 'typeof', value:'doco:BibliographicReferenceList'}]) + html + '</ul>';
};

/**
 * return one (or several) typed resource from this.pkg relevant for the
 * $node.
 * typed resource: {type: , value: }
 */
Jats2Html.prototype._typedResources = function($node) {

  var pkgTypes = ['dataset', 'sourceCode', 'image', 'audio', 'video', 'article'];

  var typedResources = [];
  var mainResource;

  //match resource with name === id
  var id = $node.getAttribute('id');
  for (var indType=0; indType<pkgTypes.length; indType++) {
    var tr = this.pkg[pkgTypes[indType]];
    if (tr) {
      for (var indResource=0; indResource<tr.length; indResource++) {
        var r = tr[indResource];
        if(r.name === id){
          mainResource = {
            type: pkgTypes[indType],
            value: r
          };
          typedResources.push(mainResource);
        }
      }
    }
  }

  //find all the hrefs
  var hrefs = [];
  var hrefId = $node.getAttribute('xlink:href');
  if (hrefId) {
    hrefs.push(hrefId);
  }

  //get all the <graphic>, <media>, <supplementary-material> with direct @xlink:href.
  //Note we only consider the immediate child of $node
  var mtags = ['graphic', 'media', 'supplementary-material'];

  for (var i=0; i< $node.childNodes.length; i++) {
    var $child = $node.childNodes[i];

    if (mtags.indexOf($child.tagName) !== -1) {

      var href = $child.getAttribute('xlink:href');
      if (href) {
        hrefs.push(href);
      }

    } else if ($child.tagName === 'alternatives') {

      mtags.forEach(function(tagName) {
        var $sel = $child.getElementsByTagName(tagName);
        if ($sel && $sel.length) {
          Array.prototype.forEach.call($sel, function($el) {
            var href = $el.getAttribute('xlink:href');
            if (href) {
              hrefs.push(href);
            }
          });
        }
      });

    }
  }

  pkgTypes.forEach(function(type) {
    (this.pkg[type] || []).forEach(function(r) {
      if (jats._match(r, type, hrefs)) {
        typedResources.push({
          type: type,
          value: r
        });
      }

      if (!mainResource && hrefId && jats._match(r, type, [hrefId])) {
        mainResource = {
          type: type,
          value: r
        };
      }

    }, this);
  }, this);

  return {
    all: typedResources,
    main: mainResource || ((typedResources.length === 1)? typedResources[0] : undefined)
  };

};

/**
 * ```typedResources``` is crated by this._typedResources($node).all
 */
Jats2Html.prototype._thumbnail = function(typedResources) {

  return _.uniq(
    typedResources
      .filter(function(x) { return x.value.thumbnailPath; })
      .map(function(x) {
        return this.selfClosingTag(null, 'img', [
          {name: 'src', value: this.ctx[x.value.thumbnailPath]}
        ]);
      }, this)
  ).join('');

};

/**
 * ```typedResources``` is crated by this._typedResources($node).all
 */
Jats2Html.prototype._link = function(typedResources) {

  return _.uniq(
    typedResources
      .map(function(x) {
        var prefix = (x.type === 'sourceCode' || x.type === 'article')? 'pkg' : 'schema';
        return this.selfClosingTag(null, 'link', [
          {name: 'about', value: this.pkgIRI},
          {name: 'rel', value: prefix + ':' +  x.type},
          {name: 'href', value: packageJsonld.BASE + x.value['@id']}
        ]);
      }, this)
  ).join('');

};

function _getPartOf(isPartOf, type) {
  if (!isPartOf) return;
  var part = isPartOf;
  while (part['@type'] !== type) {
    if (part.isPartOf) {
      part = part.isPartOf;
    } else {
      part = undefined;
      break;
    }
  }

  return part;
};

function _type(types) {
  if (!types) return;

  types = (Array.isArray(types))? types : [types];

  var typesIRI = types.map(function(t) {
    if (isUrl(t) || ~t.indexOf(':')) {
      return t;
    } else {
      return 'schema:' + t;
    }
  });

  return typesIRI.join(' ');
};

/**
 * see http://www.w3.org/TR/html4/charset.html#h-5.4
 */
function _escape(txt){
  return txt
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
};

module.exports = Jats2Html;

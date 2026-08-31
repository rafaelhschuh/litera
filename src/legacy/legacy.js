(function () {
  'use strict';
  var content = document.getElementById('content');
  var nav = document.getElementById('nav');

  function request(method, url, body, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    if (body) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var data = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch (ignore) {}
      if (xhr.status >= 200 && xhr.status < 300) done(null, data);
      else done(new Error(data.error && data.error.message ? data.error.message : 'Não foi possível concluir a solicitação.'));
    };
    xhr.send(body ? JSON.stringify(body) : null);
  }
  function empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function element(tag, className, text) { var node = document.createElement(tag); if (className) node.className = className; if (text) node.appendChild(document.createTextNode(text)); return node; }
  function routeLink(href, text) { var link = element('a', '', text); link.href = href; link.setAttribute('data-route', ''); return link; }
  function showError(error) { empty(content); content.appendChild(element('p', 'error', error.message)); }
  function navigate(href) { history.pushState({}, '', href); render(); }
  function percent(value) { return Math.round((value || 0) * 100); }

  function renderLogin() {
    nav.style.display = 'none'; empty(content);
    var form = element('form', 'form'); form.appendChild(element('p', 'eyebrow', 'Biblioteca pessoal')); form.appendChild(element('h1', '', 'Entrar no Litera'));
    var error = element('p', 'error'); error.style.display = 'none'; form.appendChild(error);
    var userLabel = element('label', '', 'Usuário'); userLabel.htmlFor = 'legacy-user'; form.appendChild(userLabel);
    var user = element('input'); user.id = 'legacy-user'; user.name = 'username'; user.autocomplete = 'username'; user.required = true; form.appendChild(user);
    var passLabel = element('label', '', 'Senha'); passLabel.htmlFor = 'legacy-password'; form.appendChild(passLabel);
    var pass = element('input'); pass.id = 'legacy-password'; pass.type = 'password'; pass.autocomplete = 'current-password'; pass.required = true; form.appendChild(pass);
    var submit = element('button', 'button', 'Entrar'); submit.type = 'submit'; form.appendChild(submit);
    form.onsubmit = function (event) { event.preventDefault(); submit.disabled = true; submit.firstChild.nodeValue = 'Entrando…'; request('POST', '/api/v1/auth/login', { username: user.value, password: pass.value }, function (failure) { submit.disabled = false; submit.firstChild.nodeValue = 'Entrar'; if (failure) { error.style.display = 'block'; error.textContent = failure.message; user.focus(); } else navigate('/legacy'); }); };
    content.appendChild(form); user.focus();
  }
  function bookList(books) {
    var list = element('ul', 'books');
    if (!books.length) { list.appendChild(element('li', 'notice', 'Nenhum livro disponível.')); return list; }
    for (var i = 0; i < books.length; i++) {
      var book = books[i], row = element('li', 'book'), cover = element('div', 'book-cover', book.title), copy = element('div', 'book-copy');
      var title = element('h2'); title.appendChild(routeLink('/legacy/books/' + book.id, book.title)); copy.appendChild(title); copy.appendChild(element('p', '', book.author || 'Autor desconhecido'));
      if (book.progressRatio) { var progress = element('div', 'progress'), bar = element('span'); bar.style.width = percent(book.progressRatio) + '%'; progress.appendChild(bar); copy.appendChild(progress); copy.appendChild(element('p', '', percent(book.progressRatio) + '% lido')); }
      row.appendChild(cover); row.appendChild(copy); list.appendChild(row);
    }
    return list;
  }
  function renderHome() { nav.style.display = 'block'; empty(content); content.appendChild(element('p', 'eyebrow', 'Sala de leitura')); content.appendChild(element('h1', '', 'Continue sua leitura')); request('GET', '/api/v1/home', null, function (error, data) { if (error) return authFailure(error); if (data.continueReading.length) { content.appendChild(bookList(data.continueReading)); } else content.appendChild(element('p', 'notice', 'Comece um livro e ele aparecerá aqui.')); content.appendChild(element('h2', '', 'Adicionados recentemente')); content.appendChild(bookList(data.recentlyAdded)); }); }
  function renderLibrary(query) { nav.style.display = 'block'; empty(content); content.appendChild(element('p', 'eyebrow', 'Acervo')); content.appendChild(element('h1', '', query ? 'Resultados da busca' : 'Biblioteca')); request('GET', '/api/v1/books' + (query ? '?q=' + encodeURIComponent(query) : ''), null, function (error, data) { if (error) return authFailure(error); content.appendChild(bookList(data.books)); }); }
  function renderSearch() { nav.style.display = 'block'; empty(content); content.appendChild(element('h1', '', 'Busca')); var form = element('form', 'search-row'), input = element('input'), button = element('button', '', 'Buscar'); input.type = 'search'; input.placeholder = 'Título ou autor'; input.setAttribute('aria-label', 'Título ou autor'); form.appendChild(input); form.appendChild(button); form.onsubmit = function (event) { event.preventDefault(); renderLibrary(input.value); }; content.appendChild(form); input.focus(); }
  function renderBook(id) { nav.style.display = 'block'; empty(content); request('GET', '/api/v1/books/' + id, null, function (error, data) { if (error) return authFailure(error); var book=data.book, detail=element('div','detail'), coverWrap=element('div','detail-cover'), cover=element('div','book-cover',book.title), copy=element('div','detail-copy'); coverWrap.appendChild(cover); copy.appendChild(element('p','eyebrow',book.format.toUpperCase())); copy.appendChild(element('h1','',book.title)); copy.appendChild(element('p','',book.author||'Autor desconhecido')); copy.appendChild(routeLink('/legacy/read/'+book.id,book.progressRatio?'Continuar leitura':'Começar leitura')); detail.appendChild(coverWrap);detail.appendChild(copy);content.appendChild(detail); }); }
  function renderReader(id) { request('GET','/api/v1/books/'+id,null,function(error,data){if(error)return authFailure(error);if(data.book.format==='pdf')renderPdfReader(id,data.book);else renderEpubReader(id);}); }
  function renderPdfReader(id,book) {
    nav.style.display='none';empty(content);content.className='reader';var toolbar=element('div','reader-toolbar'),previous=element('button','', '←'),next=element('button','', '→'),smaller=element('button','', '−'),larger=element('button','', '+'),back=routeLink('/legacy/books/'+id,'Fechar'),pageLabel=element('span','reader-page-label','Abrindo PDF…');toolbar.appendChild(back);toolbar.appendChild(previous);toolbar.appendChild(pageLabel);toolbar.appendChild(next);toolbar.appendChild(smaller);toolbar.appendChild(larger);var frame=element('iframe','reader-frame');frame.title='Documento PDF';var status=element('div','reader-status','Abrindo PDF…');content.appendChild(toolbar);content.appendChild(frame);content.appendChild(status);
    request('GET','/api/v1/books/'+id+'/progress',null,function(progressError,data){if(progressError)return authFailure(progressError);var page=Math.max(1,Math.min(book.pageCount||1,data.progress&&data.progress.locator&&data.progress.locator.page||1)),zoom=100,revision=data.progress&&data.progress.revision;function display(){var total=book.pageCount||1,ratio=total>1?(page-1)/(total-1):0;frame.src='/api/v1/books/'+id+'/content#page='+page+'&zoom='+zoom;pageLabel.textContent='Página '+page+' de '+total;status.textContent=Math.round(ratio*100)+'% · zoom '+zoom+'%';previous.disabled=page===1;next.disabled=page===total;request('PUT','/api/v1/books/'+id+'/progress',{format:'pdf',progressRatio:ratio,revision:revision,locator:{type:'pdf-page',page:page}},function(failure,result){if(!failure&&result.progress)revision=result.progress.revision;});}previous.onclick=function(){if(page>1){page--;display();}};next.onclick=function(){if(page<(book.pageCount||1)){page++;display();}};smaller.onclick=function(){zoom=Math.max(60,zoom-20);display();};larger.onclick=function(){zoom=Math.min(200,zoom+20);display();};display();});
  }
  function renderEpubReader(id) {
    nav.style.display='none';empty(content);content.className='reader';var toolbar=element('div','reader-toolbar'),previous=element('button','', '← Anterior'),next=element('button','', 'Próximo →'),smaller=element('button','', 'A−'),larger=element('button','', 'A+'),back=routeLink('/legacy/books/'+id,'Voltar ao livro');toolbar.appendChild(back);toolbar.appendChild(previous);toolbar.appendChild(next);toolbar.appendChild(smaller);toolbar.appendChild(larger);var frame=element('iframe','reader-frame');frame.setAttribute('sandbox','');frame.title='Conteúdo do livro';var status=element('div','reader-status','Abrindo livro…');content.appendChild(toolbar);content.appendChild(frame);content.appendChild(status);
    request('GET','/api/v1/books/'+id+'/epub/manifest',null,function(error,manifest){if(error)return authFailure(error);request('GET','/api/v1/books/'+id+'/progress',null,function(progressError,data){if(progressError)return authFailure(progressError);var chapters=manifest.chapters,index=0,scale=100,revision=data.progress&&data.progress.revision,saved=data.progress&&data.progress.locator;if(saved&&saved.chapterHref){for(var i=0;i<chapters.length;i++)if(chapters[i].href===saved.chapterHref)index=i;}function display(){var chapter=chapters[index];frame.src='/api/v1/books/'+id+'/epub/chapter?href='+encodeURIComponent(chapter.href)+'&scale='+scale;var ratio=chapters.length>1?index/(chapters.length-1):0;status.textContent=chapter.label+' · '+percent(ratio)+'% · texto '+scale+'%';previous.disabled=index===0;next.disabled=index===chapters.length-1;request('PUT','/api/v1/books/'+id+'/progress',{format:'epub',progressRatio:ratio,revision:revision,locator:{type:'epub-cfi',cfi:'epubcfi(/6/'+((index+1)*2)+')',chapterHref:chapter.href}},function(failure,result){if(!failure&&result.progress)revision=result.progress.revision;});}previous.onclick=function(){if(index>0){index--;display();}};next.onclick=function(){if(index<chapters.length-1){index++;display();}};smaller.onclick=function(){scale=Math.max(80,scale-10);display();};larger.onclick=function(){scale=Math.min(140,scale+10);display();};if(chapters.length)display();else status.textContent='Este EPUB não contém capítulos legíveis.';});});
  }
  function authFailure(error) { if (error.message === 'Authentication required') navigate('/legacy/login'); else showError(error); }
  function render() { var path=location.pathname,match;if(path==='/legacy/login')return renderLogin();if(path==='/legacy'||path==='/legacy/')return renderHome();if(path==='/legacy/library')return renderLibrary('');if(path==='/legacy/search')return renderSearch();match=path.match(/^\/legacy\/books\/(\d+)$/);if(match)return renderBook(match[1]);match=path.match(/^\/legacy\/read\/(\d+)$/);if(match)return renderReader(match[1]);renderLibrary(''); }
  document.onclick=function(event){var target=event.target;while(target&&target!==document){if(target.getAttribute&&target.getAttribute('data-route')!==null){event.preventDefault();navigate(target.href.replace(location.origin,''));return;}target=target.parentNode;}};
  document.getElementById('logout').onclick=function(){request('POST','/api/v1/auth/logout',null,function(){navigate('/legacy/login');});};window.onpopstate=render;render();
}());

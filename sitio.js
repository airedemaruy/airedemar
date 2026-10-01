// Menú desplegable de Sponsors y reproductor de la temporada.

// Desplegable: se abre al pasar el mouse (en compu) o al tocar (en celular), y se cierra al salir o al elegir.
document.querySelectorAll('.submenu').forEach(function (sub) {
  var puedeHover = window.matchMedia('(hover: hover)').matches;
  if (puedeHover) {
    sub.addEventListener('mouseenter', function () { sub.open = true; });
    sub.addEventListener('mouseleave', function () { sub.open = false; });
  }
  sub.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { sub.open = false; });
  });
  document.addEventListener('click', function (e) { if (!sub.contains(e.target)) sub.open = false; });
  sub.addEventListener('keydown', function (e) { if (e.key === 'Escape') { sub.open = false; sub.querySelector('summary').focus(); } });
});

// Reproductor: carga YouTube recién al tocar play, y sigue con la lista.
document.querySelectorAll('.videos').forEach(function (bloque) {
  var lista = bloque.dataset.lista;
  var caja = bloque.querySelector('.reproductor');
  function reproducir(boton) {
    var id = boton.dataset.video, i = Number(boton.dataset.i);
    var f = document.createElement('iframe');
    f.src = 'https://www.youtube-nocookie.com/embed/' + id + '?list=' + lista + '&index=' + (i + 1) + '&autoplay=1&rel=0';
    f.title = 'Aire de Mar en YouTube';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    caja.replaceChildren(f);
    bloque.querySelectorAll('.cola button').forEach(function (b) { b.removeAttribute('aria-current'); });
    var enCola = bloque.querySelector('.cola button[data-video="' + id + '"]');
    if (enCola) enCola.setAttribute('aria-current', 'true');
    if (window.matchMedia('(max-width: 860px)').matches) caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  bloque.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-video]');
    if (b) reproducir(b);
  });
});

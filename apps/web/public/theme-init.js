// Aplica o tema antes do primeiro paint (sem flash claro→escuro).
// Arquivo separado para a CSP poder proibir scripts inline.
(function () {
  try {
    var t = localStorage.getItem('nexora-theme');
    var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();

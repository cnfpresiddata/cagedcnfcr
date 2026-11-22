/* ===========================================================================
   valoriza.js: leitura da base do Confea Valoriza (FL.12 do painel e /adm)
   Porte fiel de integrar_valoriza() do pipeline Python (ExtracaoHtml13.py):
   mesmas regras de salário, jornada, cargo, município IBGE e piso da Lei
   4.950-A/66. Também normaliza as linhas da planilha para gravar no banco.
   Funciona no navegador (window.Valoriza) e no Node (module.exports).
   =========================================================================== */
(function (raiz) {
  'use strict';

  /* ---------------- piso da Lei 4.950-A/66 (base congelada pelo STF) -------- */
  const SM_BASE_PISO = 1212.0;
  const PISO_MULT = { 6: 6.0, 7: 7.25, 8: 8.5 };
  const PISO_MULT_PADRAO = 8.5;

  function jornadaDiaria(hs) {
    const h = Number(hs);
    if (!isFinite(h) || h <= 0) return null;
    const d = h / 5.0;
    if (d <= 6.5) return 6;
    if (d <= 7.5) return 7;
    return 8;
  }
  function piso4950a(hs) {
    const jd = jornadaDiaria(hs);
    if (jd === null) return null;
    return (PISO_MULT[jd] !== undefined ? PISO_MULT[jd] : PISO_MULT_PADRAO) * SM_BASE_PISO;
  }

  /* ---------------- números no padrão do Python ---------------------------- */
  // round(x, 2) do Python: arredondamento correto, empate exato vai para o par
  function fixo(x, casas) {
    const neg = x < 0, a = Math.abs(x);
    const longo = a.toFixed(60);
    const p = longo.indexOf('.');
    const resto = longo.slice(p + 1 + casas);
    if (resto[0] === '5' && /^50*$/.test(resto)) {
      const base = longo.slice(0, p + 1 + casas);
      const ult = Number(base[base.length - 1] === '.' ? base[base.length - 2] : base[base.length - 1]);
      let s = ult % 2 === 0 ? base : a.toFixed(casas);
      if (s.endsWith('.')) s = s.slice(0, -1);
      return (neg ? '-' : '') + s;
    }
    return (neg ? '-' : '') + a.toFixed(casas);
  }
  const round2 = x => Number(fixo(x, 2));
  // f"{x:,.2f}" do Python
  function milhar2(x) {
    const s = fixo(x, 2);
    const neg = s[0] === '-';
    const [i, f] = (neg ? s.slice(1) : s).split('.');
    return (neg ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + f;
  }
  // f"{x:g}" do Python (6 algarismos significativos, sem zeros à direita)
  const gfmt = x => String(Number(Number(x).toPrecision(6)));

  /* ---------------- regex com \b igual ao do Python (Unicode) --------------- */
  const W = '[\\p{L}\\p{N}_]', NW = '[^\\p{L}\\p{N}_]';
  const B = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
  function rx(fonte, flags) {
    return new RegExp(fonte.replace(/\\b/g, B), 'u' + (flags || ''));
  }
  const busca = (fonte, txt, flags) => rx(fonte, flags).test(txt);

  /* ---------------- texto ---------------------------------------------------- */
  const semAcento = t => String(t === null || t === undefined ? '' : t).normalize('NFD').replace(/\p{Mn}/gu, '');
  const vazio = v => v === null || v === undefined || (typeof v === 'number' && isNaN(v));
  const TRAV = /[\u2014\u2013\u2011]/g;
  function vt(v) {
    if (vazio(v)) return '';
    return String(v).normalize('NFKC').replace(/\u00a0/g, ' ').replace(TRAV, '-').replace(/\s+/gu, ' ').trim();
  }
  function vtn(v) {
    if (vazio(v)) return '';
    const s = String(v).normalize('NFKC').replace(/\u00a0/g, ' ').replace(TRAV, '-');
    return s.replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();
  }
  const vsa = t => semAcento(vt(t)).toLowerCase();
  function tira(t, chars) {
    let i = 0, j = t.length;
    while (i < j && chars.includes(t[i])) i++;
    while (j > i && chars.includes(t[j - 1])) j--;
    return t.slice(i, j);
  }
  const pyStrip = t => t.replace(/^\s+|\s+$/gu, '');

  function vsplit(t, sep) {
    sep = sep || ';';
    const out = []; let buf = '', prof = 0;
    for (const ch of t) {
      if (ch === '(') prof++;
      else if (ch === ')') prof = Math.max(0, prof - 1);
      if ((sep.includes(ch) || ch === '\n') && prof === 0) { out.push(buf); buf = ''; }
      else buf += ch;
    }
    out.push(buf);
    return out.filter(s => pyStrip(s));
  }

  /* ---------------- padrões (cópia dos do Python) --------------------------- */
  const RE_MOEDA = '(?:R\\$\\s*)?(\\d{1,3}(?:\\.\\d{3})+,\\d{2}|\\d{1,5},\\d{2})';
  const RE_ESTAG = '\\best\\b|estagi|estagio';
  const RE_CNJ = '(\\d{7})-(\\d{2})\\.(\\d{4})\\.(\\d)\\.(\\d{2})\\.(\\d{3,4})';
  const RE_JOR = '(\\d{1,2})\\s*(?:h(?:oras?)?)\\s*(\\d{2})?(?!\\d)|(?<![\\d,.:/])(\\d{2})(?![\\d,.:/])';
  const RE_CARGO_INI = 'eng\\.?|engenheir|engenharia|analista|fiscal|t[eé]cnic|arquitet|' +
    'agr[oô]nom|ge[oó]log|ge[oó]graf|profissional|auditor|assistente|' +
    'especialista|perito|agente|coordenador|supervisor|comprador|' +
    'meteorolog|sanitarist|qu[ií]mic';
  const RE_FILLER = rx('^(?:e|ou|de|do|da|para|os|as|o|a|demais|respectivamente|' +
    'respctivamente|respcectivamente|rspctivamente|respectivameente|' +
    'semanais|cada|um|engenharias|todos|todas|sendo|no|na|por|mes)$', 'i');
  const TIPOS = [
    ['Autarquia de saneamento', '\\bsaae\\b|\\bsamae\\b|\\bsimae\\b|\\bsemasa\\b|\\bsaerb\\b|\\bsae\\b|agua e esgoto|aguas e esgotos|saneamento'],
    ['Universidade/IF', 'universidade|instituto federal|\\bufsc\\b|\\bufrj\\b|\\bufpr\\b|\\bufma\\b|\\bufscar\\b|unirio|unifap|unilab|\\bifce\\b|centro universitario|faculdade|\\bueg\\b|\\buerj\\b'],
    ['Ministério Público', 'ministerio publico|\\bmpes\\b'],
    ['Tribunal/Defensoria', 'tribunal|defensoria'],
    ['Assembleia Legislativa', 'assembleia legislativa|\\baleam\\b|camara'],
    ['Detran/DER', 'detran|departamento estadual de transito|departamento de estradas|\\bder/'],
    ['Consórcio público', 'consorcio|codeplan|cisama|consane|conservar'],
    ['Companhia/estatal', 'companhia|\\bs\\.?a\\.?\\b|empresa|urbanizadora|prodesan|amazul|nav brasil|nitrogenados|\\bcprm\\b|emater|\\bcaer\\b|cesama|cidasc'],
    ['Polícia/segurança', 'policia|defesa social|penal'],
    ['Secretaria', 'secretaria|secretario'],
    ['Agência/instituto/fundação', 'agencia |goinfra|arismig|\\badab\\b|instituto |fundacao |\\bibge\\b|superintendencia|servico autonomo|servico municipal|servico intermunicipal'],
    ['Governo do Estado', 'governo do estado|governo de'],
    ['Prefeitura', 'prefeitura|municipal|municipio'],
  ];
  const RE_FEDERAL = '\\bfederal\\b|\\bufsc\\b|\\bufrj\\b|\\bufpr\\b|\\bufma\\b|\\bufscar\\b|unifap|unilab|\\bifce\\b|\\bibge\\b|\\bcprm\\b|amazul|nav brasil|unirio';
  const MODALIDADES = [
    ['Civil', '\\bcivil\\b|\\bcivis\\b'],
    ['Agronomia', 'agronom'],
    ['Ambiental', 'ambiental|meio ambiente'],
    ['Elétrica', 'eletricist|eletric|eletrotecnic'],
    ['Seg. do Trabalho', 'seguranca do trabalho|seg\\.? ?do trabalho|seg\\.? trabalho|engenheir[oa] do trabalho|engenharia do trabalho'],
    ['Mecânica', 'mecanic|eletromec'],
    ['Sanitária', 'sanitar'],
    ['Florestal', 'florestal'],
    ['Agrimensura/Cartografia', 'agrimens|cartograf|geodes|topograf'],
    ['Química', 'quimic'],
    ['Produção', 'producao'],
    ['Minas/Geologia', '\\bminas\\b|geolog'],
    ['Computação/Software', 'computacao|software|sistemas|informatica|\\btic\\b'],
    ['Transportes/Tráfego', 'transporte|trafego'],
    ['Geografia/Geociências', 'geograf|geocienc|geoespaci'],
    ['Meteorologia', 'meteorolog'],
    ['Alimentos', 'alimentos'],
    ['Pesca/Aquicultura', 'pesca|aquicultura'],
    ['Infraestrutura', 'infraestrutura'],
  ];
  const moedaNum = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));
  const todos = (fonte, txt, flags) => Array.from(txt.matchAll(rx(fonte, 'g' + (flags || ''))));

  /* ---------------- salário, jornada e cargo -------------------------------- */
  function limpaRot(t) {
    t = t.replace(rx('\\([^)]*R\\$[^)]*\\)', 'g'), ' ');
    t = t.replace(rx('[:\\-]+\\s*$'), '');
    t = t.replace(rx('^\\s*(?:e|ou|,|para\\s+(?:o|a|os|as)?)\\s+|\\s+(?:e|ou)\\s*$', 'gi'), ' ');
    return tira(t.replace(/\s+/gu, ' '), ' ;:.,-');
  }
  function rotUtil(txt) {
    const n = vsa(txt).replace(/[^a-z0-9 ]/g, ' ');
    const palavras = n.split(/\s+/u).filter(p => p && !RE_FILLER.test(p));
    return palavras.length > 0 && busca(RE_CARGO_INI, palavras.join(' '));
  }
  function salarios(vSal) {
    if (typeof vSal === 'number' && !isNaN(vSal)) return [[[vSal, '']], []];
    const t = vtn(vSal);
    if (!t) return [[], []];
    const pares = []; let descartados = [], buf = '';
    for (const seg of vsplit(t)) {
      const ms = todos(RE_MOEDA, seg);
      if (!ms.length) { buf = tira(buf + '; ' + pyStrip(seg), '; '); continue; }
      if (busca(RE_ESTAG, vsa(seg), 'i')) {
        descartados = descartados.concat(ms.map(m => moedaNum(m[1])));
        buf = ''; continue;
      }
      let rotSeg = '', herdavel = false, consumido = -1;
      ms.forEach((m, k) => {
        const ini = k ? ms[k - 1].index + ms[k - 1][0].length : 0;
        const bruto = k === 0 ? buf + ' ' + seg.slice(ini, m.index) : seg.slice(ini, m.index);
        const antes = limpaRot(bruto.split('R$').join(' '));
        const fim = k + 1 < ms.length ? ms[k + 1].index : seg.length;
        const depois = limpaRot(seg.slice(m.index + m[0].length, fim).split('R$').join(' '));
        let rot = '';
        if (k > consumido && antes && rotUtil(antes)) {
          rot = antes;
          if (!rotSeg) { rotSeg = rot; herdavel = true; }
        } else if (depois && rotUtil(depois)) {
          rot = depois; consumido = k;
          if (!rotSeg) { rotSeg = rot; herdavel = false; }
        } else if (herdavel) rot = rotSeg;
        pares.push([moedaNum(m[1]), rot]);
      });
      buf = '';
    }
    return [pares, descartados];
  }
  function jornadas(vJor) {
    let t = vt(vJor);
    if (!t) return [];
    t = t.split('R$').join(' ').replace(rx(RE_MOEDA, 'g'), ' ');
    const hs = [];
    for (const m of todos(RE_JOR, t, 'i')) {
      if (m[1] !== undefined) {
        let h = parseFloat(m[1]);
        if (m[2] !== undefined && parseInt(m[2], 10) > 0 && parseInt(m[2], 10) < 60) h += parseInt(m[2], 10) / 60.0;
        if (h >= 4 && h <= 60) hs.push(round2(h));
      } else if (m[3] !== undefined) {
        const h = parseFloat(m[3]);
        if (h >= 10 && h <= 48) hs.push(h);
      }
    }
    return hs;
  }
  const NEUTRAS = new Set(['engenheiro', 'engenheira', 'engenharia', 'eng', 'de', 'do', 'da', 'dos', 'das', 'em', 'e', 'o', 'a', 'para', 'cargo', 'cargos']);
  const SINONIMOS = { eletrico: 'eletricista', eletrica: 'eletricista', agronomia: 'agronomo', agronoma: 'agronomo', civis: 'civil', ambientais: 'ambiental' };
  function chaveCargo(txt) {
    const t = semAcento(vt(txt)).toLowerCase().replace(/\([^)]*\)/g, ' ');
    const pal = (t.match(/[a-z]+/g) || []).map(p => SINONIMOS[p] || p);
    return Array.from(new Set(pal.filter(p => !NEUTRAS.has(p) && p.length > 1))).sort().join('|');
  }
  function pedacosCargo(txt) {
    return vt(txt).split(/;|,|\s+e\s+|\s+ou\s+/u).map(chaveCargo).filter(k => k);
  }
  function jornadasRotuladas(vJor) {
    let t = vt(vJor);
    if (!t) return null;
    t = t.split('R$').join(' ').replace(rx(RE_MOEDA, 'g'), ' ');
    const segs = []; let algum = false;
    const limpa = x => x.replace(rx('\\b(horas?|semanais|semanal|por semana|respectivamente)\\b|[:\\-,.]', 'gi'), ' ');
    for (const seg of vsplit(t, ';')) {
      const ms = todos(RE_JOR, seg, 'i').filter(m => jornadas(m[0]).length);
      ms.forEach((m, k) => {
        const h = jornadas(m[0])[0];
        const antes = seg.slice(k ? ms[k - 1].index + ms[k - 1][0].length : 0, m.index);
        const depois = seg.slice(m.index + m[0].length, k + 1 < ms.length ? ms[k + 1].index : seg.length);
        const dep = pyStrip(limpa(depois));
        let rot;
        if (rx('^para\\b', 'i').test(dep)) rot = dep.replace(rx('^para\\s+(os\\s+|as\\s+|o\\s+|a\\s+)?', 'i'), '');
        else rot = pyStrip(limpa(antes).replace(rx('^\\s*e\\s+', 'i'), ''));
        rot = tira(rot, ' ;');
        if (busca('\\bdemais\\b', semAcento(rot).toLowerCase())) segs.push(['demais', h]);
        else if (rot && rotUtil(rot) && pedacosCargo(rot).length) { algum = true; segs.push([pedacosCargo(rot), h]); }
        else segs.push([null, h]);
      });
    }
    return algum ? segs : null;
  }
  function jornadaDaVaga(cargoVaga, rotuladas, contagem) {
    const pcs = pedacosCargo(cargoVaga);
    if (!pcs.length) return [null, null];
    let padrao = null;
    for (const [r, h] of rotuladas) if (r === 'demais') { padrao = h; break; }
    if (padrao === null) for (const [r, h] of rotuladas) if (r === null) { padrao = h; break; }
    const horas = []; let semPar = false;
    for (const p of pcs) {
      const achou = rotuladas.filter(([r]) => Array.isArray(r) && r.includes(p) && (contagem.get(p) || 0) === 1).map(x => x[1]);
      if (achou.length) horas.push(achou[0]);
      else if (rotuladas.some(([r]) => Array.isArray(r) && r.includes(p))) return [null, null];
      else { semPar = true; if (padrao !== null) horas.push(padrao); }
    }
    if (!horas.length) return [null, null];
    if (semPar && padrao === null) return [null, null];
    const distintas = Array.from(new Set(horas)).sort((a, b) => a - b);
    if (distintas.length > 1) {
      return [distintas[0], 'vaga reúne cargos de jornadas diferentes (' + distintas.map(h => gfmt(h) + 'h').join(' e ') +
        `); usada a menor, ${gfmt(distintas[0])}h, que dá o piso menor`];
    }
    return [distintas[0], null];
  }
  function cargos(vCargo) {
    const t = vt(vCargo);
    if (!t) return [];
    const partes = [];
    const reE = rx('\\s+e\\s+(?=(?:' + RE_CARGO_INI + '))', 'i');
    for (const p of vsplit(t, ';')) {
      for (const q of p.split(rx(',(?![^()]*\\))'))) {
        for (let r of q.split(reE)) {
          r = tira(r, ' .;-');
          if (r) partes.push(r);
        }
      }
    }
    return partes;
  }
  function tipoOrgao(nome) {
    const n = vsa(nome);
    for (const [rot, pat] of TIPOS) if (busca(pat, n)) return rot;
    return 'Outros';
  }
  function esfera(nome) {
    const n = vsa(nome);
    if (busca(RE_FEDERAL, n)) return 'Federal';
    if (busca('prefeitura|municipal|municipio|intermunicipal|consorcio', n)) return 'Municipal';
    return 'Estadual';
  }
  function modalidades(txt) {
    const n = vsa(txt);
    const out = MODALIDADES.filter(([, pat]) => busca(pat, n)).map(x => x[0]);
    return out.length ? out : ['Não especificada'];
  }
  function situacao(txt) {
    const n = vsa(txt);
    if (!n) return 'Não informado';
    if (busca('acao judicial postulada|submetida a apreciacao judicial|ajuizou', n)) return 'Judicializado';
    if (busca('remuneracao foi adequada|resposta administrativa positiva|atendeu o piso|atendeu o salario base|suspendeu administrativamente|excluiu os cargos|edital suspenso|ressalva expressa', n)) return 'Êxito administrativo';
    if (busca('nao postul|decadencial|nao privativo|inexist', n)) return 'Não postulado / arquivado';
    if (busca('perdeu objeto|ja estava homologado|processo arquivado|enviado ao arquivo', n)) return 'Perda de objeto / arquivado';
    if (busca('oficio enviado', n)) return 'Ofício enviado (em curso)';
    if (busca('recomendacao de revisao', n)) return 'Recomendação de revisão';
    return 'Outros';
  }
  function desdobramento(txt) {
    const n = vsa(txt);
    if (!n) return 'Sem desdobramento registrado';
    if (busca('cassad|revogad|extinto', n)) return 'Liminar cassada / extinto';
    if (busca('sentenca favoravel|confirmou|confirmada', n)) return 'Sentença favorável';
    if (busca('liminar deferida', n)) return 'Liminar deferida';
    return 'Outro desdobramento';
  }
  function judicial(txt) {
    const t = vt(txt);
    if (!t) return null;
    const m = rx(RE_CNJ).exec(t);
    if (!m) return { num: t, ano: '', trib: 'Não identificado', ok: false };
    const seg = m[4], trib = m[5];
    const rot = seg === '4' ? `TRF-${parseInt(trib, 10)}` : seg === '8' ? `TJ (${trib})` : `Justiça ${seg}.${trib}`;
    return { num: m[0], ano: m[3], trib: rot, ok: m[6].length === 4 };
  }

  /* ---------------- município (IBGE) e difflib do Python ------------------- */
  const ALIAS_MUN = {
    'moji mirim': 'mogi mirim', 'moji guacu': 'mogi guacu', 'mogi das cruzes': 'mogi das cruzes',
    'embu': 'embu das artes', 'sao luis do paraitinga': 'sao luiz do paraitinga',
    'santa isabel do para': 'santa izabel do para', 'poxoreu': 'poxoreo',
    'sao thome das letras': 'sao tome das letras', 'assu': 'acu', 'campo de santana': 'tacima',
    'sao valerio da natividade': 'sao valerio', 'brasopolis': 'brazopolis', 'dona eusebia': 'dona euzebia',
    'parati': 'paraty', 'trajano de morais': 'trajano de moraes',
  };
  const PREFIXOS_MUN = ['estancia turistica de ', 'estancia hidromineral de ', 'estancia balnearia de ',
    'estancia climatica de ', 'municipio de ', 'prefeitura municipal de ', 'prefeitura de '];
  function chaveMun(txt) {
    let t = semAcento(vt(txt)).toLowerCase();
    t = t.replace(rx('\\s*[/(-]\\s*[a-z]{2}\\s*\\)?\\s*$'), '');
    t = t.replace(rx('\\s*[/(-]\\s*[a-z]{2}\\s*\\)?\\s*$'), '');
    t = t.split("d'").join('d ').split("'").join(' ').split('-').join(' ');
    t = pyStrip(t.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/gu, ' '));
    for (const p of PREFIXOS_MUN) if (t.startsWith(p)) t = t.slice(p.length);
    return t;
  }
  // difflib.SequenceMatcher (sem lixo: nomes com menos de 200 caracteres)
  function blocos(a, b) {
    const b2j = new Map();
    b.forEach((c, i) => { if (!b2j.has(c)) b2j.set(c, []); b2j.get(c).push(i); });
    const longest = (alo, ahi, blo, bhi) => {
      let besti = alo, bestj = blo, best = 0, j2len = new Map();
      for (let i = alo; i < ahi; i++) {
        const nov = new Map();
        for (const j of (b2j.get(a[i]) || [])) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) || 0) + 1;
          nov.set(j, k);
          if (k > best) { besti = i - k + 1; bestj = j - k + 1; best = k; }
        }
        j2len = nov;
      }
      while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) { besti--; bestj--; best++; }
      while (besti + best < ahi && bestj + best < bhi && a[besti + best] === b[bestj + best]) best++;
      return [besti, bestj, best];
    };
    const fila = [[0, a.length, 0, b.length]]; let soma = 0;
    while (fila.length) {
      const [alo, ahi, blo, bhi] = fila.pop();
      const [i, j, k] = longest(alo, ahi, blo, bhi);
      if (k) {
        soma += k;
        if (alo < i && blo < j) fila.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) fila.push([i + k, ahi, j + k, bhi]);
      }
    }
    return soma;
  }
  const razao = (m, t) => t ? 2.0 * m / t : 1.0;
  function ratio(sa, sb) {
    const a = Array.from(sa), b = Array.from(sb);
    return razao(blocos(a, b), a.length + b.length);
  }
  function quickRatio(a, b) {
    const full = new Map(); for (const c of b) full.set(c, (full.get(c) || 0) + 1);
    const avail = new Map(); let m = 0;
    for (const c of a) {
      const nb = avail.has(c) ? avail.get(c) : (full.get(c) || 0);
      avail.set(c, nb - 1);
      if (nb > 0) m++;
    }
    return razao(m, a.length + b.length);
  }
  const pyCmp = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  function parecidos(palavra, possiveis, n, corte) {
    const w = Array.from(palavra), res = [];
    for (const x of possiveis) {
      const a = Array.from(x);
      if (razao(Math.min(a.length, w.length), a.length + w.length) >= corte && quickRatio(a, w) >= corte) {
        const r = razao(blocos(a, w), a.length + w.length);
        if (r >= corte) res.push([r, x]);
      }
    }
    res.sort((p, q) => q[0] - p[0] || -pyCmp(p[1], q[1]));
    return res.slice(0, n).map(p => p[1]);
  }
  function indiceIbge(ibge) {
    const idx = new Map();
    for (const [cod6, nome, uf] of (ibge || [])) idx.set(chaveMun(nome) + '\u0000' + uf, [cod6, nome]);
    const porUf = new Map(), porChave = new Map();
    for (const k of idx.keys()) {
      const [ch, uf] = k.split('\u0000');
      if (!porUf.has(uf)) porUf.set(uf, []);
      porUf.get(uf).push(ch);
      if (!porChave.has(ch)) porChave.set(ch, new Set());
      porChave.get(ch).add(uf);
    }
    return { idx, porUf, porChave, vazio: idx.size === 0 };
  }
  function casarMun(cidade, uf, I) {
    const ch = chaveMun(cidade);
    if (!ch || !uf) return [null, null, 'cidade ou UF vazia'];
    const get = c => I.idx.get(c + '\u0000' + uf);
    if (get(ch)) return [...get(ch), 'exato'];
    const al = ALIAS_MUN[ch];
    if (al && get(al)) return [...get(al), 'grafia'];
    const lista = I.porUf.get(uf) || [];
    const cand = parecidos(ch, lista, 2, 0.90);
    if (cand.length === 1 || (cand.length === 2 && ratio(ch, cand[0]) > ratio(ch, cand[1]) + 0.03)) {
      return [...get(cand[0]), 'aproximado'];
    }
    const outras = Array.from(I.porChave.get(ch) || []).filter(u => u !== uf).sort(pyCmp);
    if (outras.length) return [null, null, 'nome existe no IBGE só em ' + outras.join(', ') + '; confira a UF na planilha'];
    const sug = parecidos(ch, lista, 1, 0.75);
    if (sug.length) return [null, null, `sem correspondência segura; o mais parecido em ${uf} é ${get(sug[0])[1]}`];
    return [null, null, 'não encontrado no IBGE para a UF informada'];
  }

  /* ---------------- leitura de um processo (vagas e apontamentos) ----------- */
  // r: linha da base (campos numero, processo, cidade, estado, orgao, cargo,
  // jornada, salario, status, judicial, desdobramento). I: índice do IBGE.
  function lerProcesso(r, I) {
    const lin = r.numero;
    let cidade = vt(r.cidade);
    const uf = vt(r.estado).toUpperCase().slice(0, 2);
    const orgao = vt(r.orgao);
    const res = { lin, ignorado: false, avisos: [], vagas: [], cidade, uf, orgao, mun: '', semSalario: false, casado: false };
    if (!(cidade || orgao)) { res.ignorado = true; return res; }
    const [pares, estag] = salarios(r.salario);
    const jor = jornadas(r.jornada);
    const car = cargos(r.cargo);
    const av = res.avisos;
    if (estag.length) av.push([lin, 'Valor de estagiário excluído do cálculo', estag.map(x => 'R$ ' + milhar2(x)).join('; ').split(',').join('.')]);
    const vaz = todos(RE_MOEDA, vt(r.jornada)).map(m => moedaNum(m[1]));
    if (vaz.length && pares.length && Math.abs(vaz[0] - pares[0][0]) > 0.01) {
      av.push([lin, 'Salário divergente entre as colunas Jornada e Salário',
        `Jornada = ${fixo(vaz[0], 2)} · Salário = ${fixo(pares[0][0], 2)} (prevalece a coluna Salário)`]);
    }
    if (!pares.length) { res.semSalario = true; av.push([lin, 'Sem salário apurável', vt(r.salario) || '(vazio)']); }
    if (!jor.length) av.push([lin, 'Sem jornada apurável', vt(r.jornada) || '(vazio)']);
    if (car.length && pares.length > 1 && car.length !== pares.length && !pares.some(p => p[1])) {
      av.push([lin, 'Nº de cargos ≠ nº de salários (pareado por posição)', `${car.length} cargos × ${pares.length} salários`]);
    }
    const jud = judicial(r.judicial);
    if (jud && !jud.ok) av.push([lin, 'Processo judicial fora do padrão CNJ', jud.num]);
    res.tipo = tipoOrgao(orgao); res.esfera = esfera(orgao);
    res.situacao = situacao(r.status); res.desdobramento = desdobramento(r.desdobramento);
    res.tribunal = (jud || {}).trib || 'Sem ação judicial';
    res.ufRot = uf || 'n/d';
    res.jud = jud;
    if (I && !I.vazio) {
      const [cod6, nomeOf, como] = casarMun(cidade, uf, I);
      if (cod6) {
        res.casado = true; res.mun = cod6;
        if (como !== 'exato') av.push([lin, 'Município ajustado ao nome oficial do IBGE', `${cidade}/${uf} lido como ${nomeOf}/${uf} (${como})`]);
        cidade = nomeOf;
      } else av.push([lin, 'Município não localizado no IBGE', `${cidade}/${uf}: ${como}`]);
    }
    res.cidade = cidade;
    const ns = pares.length;
    const rotJor = jornadasRotuladas(r.jornada);
    const contJor = new Map();
    if (rotJor) {
      const cgs = [];
      for (let k = 0; k < ns; k++) {
        const rr = pares[k][1];
        cgs.push(rr ? rr : (car.length && car.length === ns ? car[k] : ''));
      }
      for (const cg of cgs) for (const p of new Set(pedacosCargo(cg))) contJor.set(p, (contJor.get(p) || 0) + 1);
    }
    for (let k = 0; k < ns; k++) {
      const [val, rot] = pares[k];
      let cgo;
      if (rot) cgo = rot;
      else if (!car.length) cgo = '';
      else if (car.length === ns) cgo = car[k];
      else if (ns === 1) cgo = car.join('; ');
      else if (k === ns - 1 && car.length > ns) cgo = car.slice(k).join('; ');
      else if (k < car.length) cgo = car[k];
      else cgo = car[car.length - 1];
      let h = !jor.length ? null : (k < jor.length ? jor[k] : jor[jor.length - 1]);
      if (rotJor) {
        const [hc, det] = jornadaDaVaga(cgo, rotJor, contJor);
        if (hc !== null) {
          if (det) av.push([lin, 'Jornada mista na mesma vaga', `${cgo}: ${det}`]);
          h = hc;
        }
      }
      const piso = h ? piso4950a(h) : null;
      res.vagas.push({
        cargo: cgo, salario: round2(val), horas: h ? h : 0, piso: piso ? round2(piso) : 0,
        mods: modalidades(cgo || vt(r.cargo)),
      });
    }
    return res;
  }

  /* ---------------- cubo da FL.12 (mesma forma do Python) ------------------- */
  function montarCubo(linhas, ibge) {
    const I = indiceIbge(ibge);
    const ufs = [], tipos = [], esfs = [], sts = [], mods = [], tribs = [], dsds = [];
    const ix = (lista, v) => { let i = lista.indexOf(v); if (i < 0) { lista.push(v); i = lista.length - 1; } return i; };
    const cubo = { uf: [], tipo: [], esf: [], st: [], trib: [], dsd: [], mod: [], sal: [], h: [], piso: [], jud: [], ano: [], cid: [], org: [], cgo: [], proc: [], lin: [], mun: [] };
    let avisos = [], processos = 0, semSal = 0, casados = 0;
    for (const r of linhas) {
      const p = lerProcesso(r, I);
      if (p.ignorado) continue;
      processos++;
      if (p.semSalario) semSal++;
      if (p.casado) casados++;
      avisos = avisos.concat(p.avisos);
      const iTipo = ix(tipos, p.tipo), iEsf = ix(esfs, p.esfera), iSt = ix(sts, p.situacao),
        iDsd = ix(dsds, p.desdobramento), iTrib = ix(tribs, p.tribunal), iUf = ix(ufs, p.ufRot);
      for (const v of p.vagas) {
        cubo.uf.push(iUf); cubo.tipo.push(iTipo); cubo.esf.push(iEsf); cubo.st.push(iSt);
        cubo.trib.push(iTrib); cubo.dsd.push(iDsd);
        cubo.mod.push(v.mods.map(m => ix(mods, m)));
        cubo.sal.push(v.salario); cubo.h.push(v.horas); cubo.piso.push(v.piso);
        cubo.jud.push(p.jud ? 1 : 0); cubo.ano.push((p.jud || {}).ano || '');
        cubo.cid.push(p.cidade); cubo.org.push(p.orgao); cubo.mun.push(p.mun || '');
        cubo.cgo.push(v.cargo); cubo.proc.push(vt(r.processo)); cubo.lin.push(p.lin);
      }
    }
    Object.assign(cubo, { ufs, tipos, esfs, status: sts, mods, tribs, dsds, avisos });
    const n = cubo.sal.length;
    let abaixo = 0;
    for (let j = 0; j < n; j++) if (cubo.piso[j] && cubo.sal[j] < cubo.piso[j]) abaixo++;
    const meta = {
      vlz_processos: processos, vlz_vagas: n, vlz_abaixo: abaixo, vlz_sem_salario: semSal,
      vlz_avisos: avisos.length, vlz_mun_casados: casados, vlz_mun_ibge: !I.vazio, vlz_base: SM_BASE_PISO,
      vlz_status: n ? 'ok' : 'vazia',
      vlz_msg: `${processos} processos administrativos e ${n} vagas apuradas; ${abaixo} abaixo do piso; ${avisos.length} apontamentos de auditoria.`,
    };
    return { cubo, meta };
  }

  /* ---------------- normalização das linhas para gravar --------------------- */
  const CAMPOS = ['numero', 'processo', 'cidade', 'estado', 'orgao', 'cargo', 'jornada', 'salario', 'regime', 'status', 'judicial', 'comarca', 'desdobramento'];
  const ROTULOS = {
    numero: 'Nº', processo: 'Nº do processo administrativo', cidade: 'Cidade', estado: 'Estado', orgao: 'Órgão público',
    cargo: 'Cargo da área tecnológica', jornada: 'Jornada semanal', salario: 'Salário', regime: 'Regime jurídico da contratação',
    status: 'Status', judicial: 'Nº do processo judicial (mandado de segurança)', comarca: 'Comarca do processo judicial',
    desdobramento: 'Desdobramento',
  };
  // cabeçalho da planilha -> campo (mesma comparação do Python: sem acento e minúsculo)
  const CABECALHOS = {
    numero: ['nº', 'n°', 'no', 'numero', 'número'], processo: ['nº do processo administrativo', 'numero do processo administrativo', 'processo administrativo'],
    cidade: ['cidade', 'município', 'municipio'], estado: ['estado', 'uf'], orgao: ['órgão público', 'órgão', 'orgao publico'],
    cargo: ['cargo da área tecnológica', 'cargo'], jornada: ['jornada semanal', 'jornada'], salario: ['salário', 'salario'],
    regime: ['regime jurídico da contratação', 'regime jurídico', 'regime'], status: ['status', 'situação'],
    judicial: ['número do processo judicial - mandado de segurança', 'número do processo judicial', 'processo judicial'],
    comarca: ['comarca processo judicial', 'comarca do processo judicial', 'comarca'], desdobramento: ['desdobramento'],
  };
  const chaveCab = t => vsa(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const MAPA_CAB = new Map();
  for (const [campo, nomes] of Object.entries(CABECALHOS)) for (const n of nomes) MAPA_CAB.set(chaveCab(n), campo);
  function campoDoCabecalho(t) { return MAPA_CAB.get(chaveCab(t)) || null; }

  // texto como a pessoa escreveu, só sem espaços sobrando e sem caracteres de controle
  function normTexto(v) {
    if (vazio(v)) return null;
    let s;
    if (v instanceof Date){
      const d2 = n => String(n).padStart(2, '0');
      s = `${d2(v.getDate())}/${d2(v.getMonth() + 1)}/${v.getFullYear()}`;
      if (v.getHours() || v.getMinutes()) s += ` ${d2(v.getHours())}:${d2(v.getMinutes())}`;
      return s;
    }
    s = String(v);
    s = s.normalize('NFC').replace(/\r\n?|[\u2028\u2029\u0085\u000b\u000c\u001c-\u001e]/g, '\n')
      .replace(/[\t\u001f\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
      .replace(/[\u0000-\u0008\u000e-\u001b\u007f-\u0084\u0086-\u009f]/g, '');
    s = s.split('\n').map(l => l.replace(/ +/g, ' ').trim()).filter(l => l).join('\n');
    return s || null;
  }
  const moedaBR = x => 'R$ ' + fixo(x, 2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  function normSalario(v) {
    if (typeof v === 'number' && isFinite(v)) return moedaBR(v);
    return normTexto(v);
  }
  // devolve { linha, erros[] } com a linha pronta para o banco
  function normalizarLinha(bruta) {
    const erros = [];
    const out = {};
    for (const c of CAMPOS) {
      const v = bruta[c];
      if (c === 'numero') {
        let n = null;
        if (typeof v === 'number' && isFinite(v)) n = v;
        else if (!vazio(v) && /^\s*\d+\s*$/.test(String(v))) n = parseInt(String(v), 10);
        if (n === null || !Number.isInteger(n) || n <= 0) erros.push(vazio(v) || String(v).trim() === '' ? 'sem Nº' : `Nº inválido ("${String(v).trim()}")`);
        out.numero = n;
      } else if (c === 'salario') out.salario = normSalario(v);
      else if (c === 'estado') {
        const t = normTexto(v);
        const u = t ? t.toUpperCase() : null;
        if (u && !/^[A-Z]{2}$/.test(u)) erros.push(`Estado inválido ("${t}"): use a sigla com 2 letras`);
        out.estado = u;
      } else out[c] = normTexto(v);
    }
    if (!out.processo) erros.push('sem Nº do processo administrativo');
    const extras = {};
    for (const [k, v] of Object.entries(bruta.extras || {})) { const t = normTexto(v); if (t !== null) extras[k] = t; }
    out.extras = Object.keys(extras).length ? extras : null;
    return { linha: out, erros };
  }

  const api = {
    CAMPOS, ROTULOS, SM_BASE_PISO, campoDoCabecalho, chaveCab, normTexto, normSalario, normalizarLinha,
    lerProcesso, montarCubo, indiceIbge, casarMun, piso4950a, jornadaDiaria, round2, fixo, milhar2, moedaBR,
    _int: { salarios, jornadas, cargos, jornadasRotuladas, chaveMun, parecidos, ratio, situacao, desdobramento, judicial, tipoOrgao, esfera, modalidades, vt, vtn, vsa },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Valoriza = api;
})(typeof window !== 'undefined' ? window : globalThis);

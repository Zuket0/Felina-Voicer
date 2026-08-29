const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ini = require('ini');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const STATIC_DIR = path.join(__dirname, 'static');
const PACKS_DIR = path.join(STATIC_DIR, 'res', 'packs_voice');

app.use('/static', express.static(STATIC_DIR));

if (!fs.existsSync(PACKS_DIR)) {
  fs.mkdirSync(PACKS_DIR, { recursive: true });
}

const conversionQueue = [];
let isConverting = false;
const queueProgress = {};

// Normalizador seguro de cadenas de array tipo ["Shrek", "Burro"] o "Shrek, Burro"
function parseArrayField(fieldVal) {
  if (!fieldVal) return [];
  if (Array.isArray(fieldVal)) return fieldVal.map(cleanCharacterName).filter(Boolean);

  let raw = String(fieldVal).trim();
  if (raw.startsWith('[') && raw.endsWith(']')) {
    raw = raw.slice(1, -1);
  }

  try {
    const parsed = JSON.parse(`[${raw}]`);
    if (Array.isArray(parsed)) return parsed.map(cleanCharacterName).filter(Boolean);
  } catch (e) {}

  return raw
    .split(',')
    .map(s => s.replace(/["'\[\]]/g, '').trim())
    .map(cleanCharacterName)
    .filter(Boolean);
}

// Sanitizador de INI/TXT
function sanitizeAndParseIni(rawText) {
  if (!rawText) return {};

  const cleanedText = rawText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  let parsed = {};
  try {
    const res = ini.parse(cleanedText);
    parsed = res.data || res;
  } catch (e) {}

  if (!parsed.title) {
    const titleMatch = cleanedText.match(/title\s*=\s*["']?([^"'\r\n]+)["']?/i);
    if (titleMatch) parsed.title = titleMatch[1];
  }

  if (!parsed.icon) {
    const iconMatch = cleanedText.match(/icon\s*=\s*["']?([^"'\r\n]+)["']?/i);
    if (iconMatch) parsed.icon = iconMatch[1];
  }

  if (!parsed.readme && !parsed.subtitle) {
    const readmeMatch = cleanedText.match(/readme\s*=\s*["']?([^"'\r\n]+)["']?/i);
    if (readmeMatch) parsed.readme = readmeMatch[1];
  }

  if (!parsed.preselected_dub_characters) {
    const preMatch = cleanedText.match(/preselected_dub_characters\s*=\s*(.+)/i);
    if (preMatch) {
      parsed.preselected_dub_characters = preMatch[1];
    }
  }

  if (!parsed.caption) {
    const captionMatch = cleanedText.match(/caption\s*=\s*["']?([^"'\r\n]+)["']?/i);
    if (captionMatch) parsed.caption = captionMatch[1];
  }

  if (!parsed.dub_timestamps) {
    const tsMatch = cleanedText.match(/dub_timestamps\s*=\s*(.+)/i);
    if (tsMatch) {
      parsed.dub_timestamps = tsMatch[1];
    }
  }

  if (!parsed.dub_characters) {
    const charMatch = cleanedText.match(/dub_characters\s*=\s*(.+)/i);
    if (charMatch) {
      parsed.dub_characters = charMatch[1];
    }
  }

  if (!parsed.image) {
    const imgMatch = cleanedText.match(/image\s*=\s*["']?([^"'\r\n]+)["']?/i);
    if (imgMatch) parsed.image = imgMatch[1];
  }

  return parsed;
}

function cleanCharacterName(rawName) {
  if (!rawName) return '';
  let cleaned = String(rawName).replace(/["'\[\]]/g, '').trim();
  cleaned = cleaned.replace(/[\-_]?\d+$/g, '').trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

function findPackIcon(files, infoData, folder) {
  let iconFile = null;

  if (infoData && infoData.icon) {
    const declaredName = String(infoData.icon).replace(/\.(png|jpg|jpeg|webp|ico)$/i, '').toLowerCase();
    iconFile = files.find(f => {
      const base = f.replace(/\.(png|jpg|jpeg|webp|ico)$/i, '').toLowerCase();
      return base === declaredName && /\.(png|jpg|jpeg|webp|ico)$/i.test(f);
    });
  }

  if (!iconFile) {
    iconFile = files.find(f => /^(_?icon|cover|logo|thumb|poster|titlescreen)\.(png|jpg|jpeg|webp|ico)$/i.test(f));
  }

  return iconFile ? `/static/res/packs_voice/${encodeURIComponent(folder)}/${iconFile}` : null;
}

function getPackMeta(folder) {
  const currentPackDir = path.join(PACKS_DIR, folder);
  let title = folder;
  let iconUrl = null;

  if (fs.existsSync(currentPackDir)) {
    const files = fs.readdirSync(currentPackDir);
    const infoFile = files.find(f => /^(_pack_info|\.pack_info)\.(ini|txt)$/i.test(f));
    let infoData = {};
    if (infoFile) {
      try {
        const raw = fs.readFileSync(path.join(currentPackDir, infoFile), 'utf-8');
        infoData = sanitizeAndParseIni(raw);
        if (infoData.title) title = infoData.title;
      } catch (e) {}
    }
    iconUrl = findPackIcon(files, infoData, folder);
  }

  return { title, iconUrl };
}

function addToQueue(folder) {
  const ogvPath = path.join(PACKS_DIR, folder, 'dub_video.ogv');
  const mp4Path = path.join(PACKS_DIR, folder, 'dub_video.mp4');

  if (fs.existsSync(mp4Path)) return;
  if (!fs.existsSync(ogvPath)) return;
  if (conversionQueue.includes(folder) || (queueProgress[folder] && queueProgress[folder].status === 'converting')) return;

  const { title, iconUrl } = getPackMeta(folder);
  queueProgress[folder] = {
    folder,
    title,
    icon: iconUrl,
    percent: 0,
    status: 'queued'
  };

  conversionQueue.push(folder);
  processNextInQueue();
}

function processNextInQueue() {
  if (isConverting || conversionQueue.length === 0) return;

  const currentFolder = conversionQueue.shift();
  const ogvPath = path.join(PACKS_DIR, currentFolder, 'dub_video.ogv');
  const mp4Path = path.join(PACKS_DIR, currentFolder, 'dub_video.mp4');

  if (fs.existsSync(mp4Path)) {
    if (queueProgress[currentFolder]) queueProgress[currentFolder].status = 'ready';
    return processNextInQueue();
  }

  isConverting = true;
  if (!queueProgress[currentFolder]) {
    const { title, iconUrl } = getPackMeta(currentFolder);
    queueProgress[currentFolder] = { folder: currentFolder, title, icon: iconUrl, percent: 0, status: 'converting' };
  } else {
    queueProgress[currentFolder].status = 'converting';
  }

  console.log(`\n[FIFO] Procesando: "${currentFolder}"...`);

  ffmpeg(ogvPath)
    .outputOptions(['-c:v libx264', '-preset ultrafast', '-crf 23', '-pix_fmt yuv420p', '-an'])
    .on('progress', (p) => {
      const pct = Math.min(99, Math.max(1, Math.round(p.percent || 0)));
      if (queueProgress[currentFolder]) {
        queueProgress[currentFolder].percent = pct;
      }
    })
    .on('end', () => {
      console.log(`[FIFO] Finalizado: "${currentFolder}"`);
      if (queueProgress[currentFolder]) {
        queueProgress[currentFolder].percent = 100;
        queueProgress[currentFolder].status = 'ready';
      }
      isConverting = false;
      processNextInQueue();
    })
    .on('error', (err) => {
      console.error(`[FIFO] Error en "${currentFolder}":`, err.message);
      if (queueProgress[currentFolder]) {
        queueProgress[currentFolder].status = 'error';
      }
      isConverting = false;
      processNextInQueue();
    })
    .save(mp4Path);
}

// Escáner de Voice Packs
function parsePackData(folder) {
  const currentPackDir = path.join(PACKS_DIR, folder);
  if (!fs.existsSync(currentPackDir) || !fs.statSync(currentPackDir).isDirectory()) return null;

  const files = fs.readdirSync(currentPackDir);

  // 1. Metadatos generales
  let infoData = {};
  const infoFile = files.find(f => /^(_pack_info|\.pack_info)\.(ini|txt)$/i.test(f));
  if (infoFile) {
    try {
      const raw = fs.readFileSync(path.join(currentPackDir, infoFile), 'utf-8');
      infoData = sanitizeAndParseIni(raw);
    } catch (e) {}
  }

  // 2. Icono
  const iconUrl = findPackIcon(files, infoData, folder);

  // 3. Audio de fondo
  const backingTrackFile = files.find(f => /^_backing_track\.(mp3|ogg|wav|m4a|aac)$/i.test(f));
  const backingTrackUrl = backingTrackFile
    ? `/static/res/packs_voice/${encodeURIComponent(folder)}/${backingTrackFile}`
    : null;

  // 4. Video MP4 / OGV
  const mp4Exists = files.some(f => f.toLowerCase() === 'dub_video.mp4');
  let videoUrl = mp4Exists
    ? `/static/res/packs_voice/${encodeURIComponent(folder)}/dub_video.mp4`
    : `/static/res/packs_voice/${encodeURIComponent(folder)}/dub_video.ogv`;

  if (!mp4Exists && files.some(f => f.toLowerCase() === 'dub_video.ogv')) {
    addToQueue(folder);
  }

  // 5. Lista de personajes base deserializada
  const declaredCharacters = parseArrayField(infoData.preselected_dub_characters);

  // 6. Detección de todas las frases (.ini y .txt)
  const phraseConfigFiles = files.filter(f => /^\d+_.+\.(ini|txt)$/i.test(f));
  const charactersSet = new Set(declaredCharacters);
  const parsedPhrases = [];

  phraseConfigFiles.forEach(configFile => {
    try {
      const raw = fs.readFileSync(path.join(currentPackDir, configFile), 'utf-8');
      const parsed = sanitizeAndParseIni(raw);
      const prefix = configFile.replace(/\.(ini|txt)$/i, '');

      const match = configFile.match(/^(\d+)_(.+)\.(ini|txt)$/i);
      const numId = match ? parseInt(match[1], 10) : 0;
      const fileCharPart = match ? match[2] : '';

      const charsInPhrase = parseArrayField(parsed.dub_characters);
      let charName = '';
      if (charsInPhrase.length > 0) {
        charName = charsInPhrase[0];
      } else {
        charName = cleanCharacterName(fileCharPart);
      }

      if (charName) charactersSet.add(charName);

      // Timestamps
      let timestamps = parseArrayField(parsed.dub_timestamps);
      const finalTimestamp = timestamps.length > 0 ? parseFloat(timestamps[0]) : 0;

      // Imagen
      let imageFile = null;
      if (parsed.image) {
        const declared = String(parsed.image).replace(/\.(png|jpg|jpeg|webp)$/i, '').toLowerCase();
        imageFile = files.find(f => f.replace(/\.(png|jpg|jpeg|webp)$/i, '').toLowerCase() === declared && /\.(png|jpg|jpeg|webp)$/i.test(f));
      }
      if (!imageFile) {
        imageFile = files.find(f => {
          const base = f.replace(/\.(png|jpg|jpeg|webp)$/i, '').toLowerCase();
          return base === prefix.toLowerCase() && /\.(png|jpg|jpeg|webp)$/i.test(f);
        });
      }

      // Audio
      let audioFile = files.find(f => {
        const base = f.replace(/\.(mp3|ogg|wav|m4a|aac)$/i, '').toLowerCase();
        return base === prefix.toLowerCase() && /\.(mp3|ogg|wav|m4a|aac)$/i.test(f);
      });

      const captionText = parsed.caption || `Frase ${prefix}`;

      parsedPhrases.push({
        numId: numId,
        charName: charName,
        prefix: prefix,
        caption: captionText,
        imageSrc: imageFile ? `/static/res/packs_voice/${encodeURIComponent(folder)}/${imageFile}` : '',
        audioSrc: audioFile ? `/static/res/packs_voice/${encodeURIComponent(folder)}/${audioFile}` : '',
        timestamp: isNaN(finalTimestamp) ? 0 : finalTimestamp
      });
    } catch (e) {}
  });

  // 7. Orden de personajes limpio
  let characterOrder = declaredCharacters;
  if (characterOrder.length === 0) {
    characterOrder = Array.from(charactersSet);
  } else {
    charactersSet.forEach(c => {
      if (!characterOrder.includes(c)) characterOrder.push(c);
    });
  }

  // 8. Ordenamiento de frases (personaje por personaje, luego número)
  parsedPhrases.sort((a, b) => {
    const charIndexA = characterOrder.indexOf(a.charName);
    const charIndexB = characterOrder.indexOf(b.charName);

    const orderA = charIndexA !== -1 ? charIndexA : 999;
    const orderB = charIndexB !== -1 ? charIndexB : 999;

    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.numId - b.numId;
  });

  const phrases = parsedPhrases.map((item, index) => ({
    id: index + 1,
    caption: item.caption,
    charName: item.charName,
    imageSrc: item.imageSrc,
    audioSrc: item.audioSrc,
    timestamp: item.timestamp
  }));

  const isReady = mp4Exists || (queueProgress[folder] && queueProgress[folder].status === 'ready');

  let displaySubtitle = infoData.subtitle || infoData.readme || "";
  if (!displaySubtitle && infoData.authors) {
    const authors = Array.isArray(infoData.authors) ? infoData.authors.join(', ') : infoData.authors;
    displaySubtitle = `Por ${authors}`;
  }

  return {
    id: folder,
    title: infoData.title || folder,
    subtitle: displaySubtitle,
    thumbnail: iconUrl,
    backingTrack: backingTrackUrl,
    videoSrc: videoUrl,
    isReady: isReady,
    characters: characterOrder,
    phrases: phrases
  };
}

app.get('/api/packs', (req, res) => {
  try {
    const folders = fs.readdirSync(PACKS_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    const packs = folders.map(f => parsePackData(f)).filter(Boolean);
    res.json(packs);
  } catch (err) {
    res.status(500).json({ error: "Error al escanear packs" });
  }
});

app.get('/api/queue-status', (req, res) => {
  res.json(queueProgress);
});

fs.watch(PACKS_DIR, (eventType, filename) => {
  if (filename) {
    const folderPath = path.join(PACKS_DIR, filename);
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
      addToQueue(filename);
    }
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n Servidor ChoicerVoicer listo en: http://localhost:${PORT}`);
  console.log(` Carpeta monitoreada: ${PACKS_DIR}\n`);
});
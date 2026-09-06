let currentPolicy = {
  format: 'wav',
  allowMp3Fallback: false,
};

function normalizeDownloadPolicy(value = {}) {
  const format = String(value.format || '').toLowerCase() === 'mp3' ? 'mp3' : 'wav';
  return {
    format,
    allowMp3Fallback: format === 'wav' ? Boolean(value.allowMp3Fallback) : true,
  };
}

function getDownloadPolicy() {
  return { ...currentPolicy };
}

function setDownloadPolicy(value = {}) {
  currentPolicy = normalizeDownloadPolicy(value);
  return getDownloadPolicy();
}

module.exports = {
  normalizeDownloadPolicy,
  getDownloadPolicy,
  setDownloadPolicy,
};

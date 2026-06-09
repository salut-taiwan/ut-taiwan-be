const { rewriteStorageUrl } = require('../format');
const env = require('../config/env');

const BASE = `${env.SUPABASE_URL}/storage/v1/object/public/panduan`;

const CATEGORIES = [
  {
    id: 'mahasiswa-baru',
    guides: [
      { title: 'Proses Pendaftaran Mahasiswa Baru (Diploma & Sarjana)', file: 'mahasiswa-baru/proses-pendaftaran-diploma-sarjana.pdf' },
      { title: 'Pedoman Pendaftaran Mahasiswa Baru (Admisi)',           file: 'mahasiswa-baru/pendaftaran-mahasiswa-baru.pdf' },
      { title: 'Pedoman Registrasi Data Pribadi',                       file: 'mahasiswa-baru/registrasi-data-pribadi.pdf' },
      { title: 'Pedoman Aktivasi Akun Ulang',                           file: 'mahasiswa-baru/aktivasi-akun-ulang.pdf' },
      { title: 'Pedoman Forgot Password',                               file: 'mahasiswa-baru/forgot-password.pdf' },
      { title: 'Cara Setting Spam Email SIA',                           file: 'mahasiswa-baru/setting-spam-email.pdf' },
    ],
  },
  {
    id: 'login-sistem',
    guides: [
      { title: 'Pedoman Login dengan eCampus', file: 'login-sistem/pedoman-login-ecampus.pdf' },
    ],
  },
  {
    id: 'registrasi-matakuliah',
    guides: [
      { title: 'Panduan Registrasi SIPAS',     file: 'registrasi-matakuliah/registrasi-sipas.pdf' },
      { title: 'Panduan Registrasi Non-SIPAS', file: 'registrasi-matakuliah/registrasi-non-sipas.pdf' },
    ],
  },
  {
    id: 'pembayaran',
    guides: [
      { title: 'Pembayaran via Tokopedia',                  file: 'pembayaran/pembayaran-tokopedia.pdf' },
      { title: 'Pembayaran via Bank BRI',                   file: 'pembayaran/pembayaran-bank-bri.pdf' },
      { title: 'Pembayaran via Bank BTN',                   file: 'pembayaran/pembayaran-bank-btn.pdf' },
      { title: 'Pembayaran via Bank Mandiri',               file: 'pembayaran/pembayaran-bank-mandiri.pdf' },
      { title: 'Pembayaran via Bank BSI (Virtual Account)', file: 'pembayaran/pembayaran-bank-bsi.pdf' },
    ],
  },
  {
    id: 'ujian-tugas',
    guides: [
      { title: 'Panduan Registrasi Ujian Online (UO)', file: 'ujian-tugas/registrasi-uo.pdf' },
    ],
  },
];

function getCategories(req, res) {
  const categories = CATEGORIES.map(cat => ({
    id: cat.id,
    guides: cat.guides.map(g => ({
      title: g.title,
      url: rewriteStorageUrl(`${BASE}/${g.file}`),
    })),
  }));
  res.json(categories);
}

module.exports = { getCategories };

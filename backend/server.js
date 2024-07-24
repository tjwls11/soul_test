const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3011;
const saltRounds = 10;
const secretKey = process.env.SECRET_KEY || 'test1234';

// 미들웨어 설정
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL 연결 설정
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: process.env.DB_PASSWORD || 'tjwls100',
  database: 'soul'
});

db.connect(err => {
  if (err) {
    console.error('MySQL 연결 실패:', err);
    process.exit(1);
  }
});

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads', 'stickers');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// 인증 미들웨어
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1];
  
  console.log('Auth Header:', authHeader); // 로그 추가
  console.log('Token:', token); // 로그 추가

  if (!token) return res.sendStatus(401);

  jwt.verify(token, secretKey, (err, user) => {
    if (err) {
      console.error('JWT Verification Error:', err); // 로그 추가
      return res.sendStatus(403);
    }
    req.user = user;
    next();
  });
};

// 정적 파일 서빙
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 기본 엔드포인트
app.get('/', (req, res) => {
  res.send('서버가 실행 중입니다.');
});

// 회원가입 엔드포인트
app.post('/signup', (req, res) => {
  const { name, userId, password } = req.body;

  if (!name || !userId || !password) {
    return res.status(400).json({ isSuccess: false, message: '모든 필드를 입력해주세요.' });
  }

  bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }

    const sql = 'INSERT INTO users (name, user_id, password, coins) VALUES (?, ?, ?, ?)';
    db.query(sql, [name, userId, hash, 5000], (err) => {
      if (err) {
        return res.status(500).json({ isSuccess: false, message: '사용자 생성 실패' });
      }
      res.status(201).json({ isSuccess: true, message: '회원가입 성공' });
    });
  });
});

// 로그인 엔드포인트
app.post('/login', (req, res) => {
  const { userId, password } = req.body;

  if (!userId || !password) {
    return res.status(400).json({ isSuccess: false, message: '모든 필드를 입력해주세요.' });
  }

  const sql = 'SELECT * FROM users WHERE user_id = ?';
  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    if (results.length === 0) {
      return res.status(401).json({ isSuccess: false, message: '사용자 없음' });
    }

    const user = results[0];
    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ isSuccess: false, message: '서버 오류' });
      }
      if (!isMatch) {
        return res.status(401).json({ isSuccess: false, message: '비밀번호 불일치' });
      }

      const token = jwt.sign({ id: user.id, name: user.name, userId: user.user_id }, secretKey, { expiresIn: '1h' });
      res.json({ isSuccess: true, message: '로그인 성공', token, user: { id: user.id, name: user.name, userId: user.user_id, coins: user.coins } });
    });
  });
});

// 스티커 업로드
app.post('/api/upload-sticker', [authenticateToken, upload.single('image')], (req, res) => {
  const { name, price } = req.body;
  const image = req.file?.filename;
  const userId = req.user.userId;

  if (!name || !image || price === undefined) {
    return res.status(400).json({ isSuccess: false, message: '스티커 이름, 이미지, 가격을 입력해주세요.' });
  }

  const sql = 'INSERT INTO stickers (name, image, user_id, price) VALUES (?, ?, ?, ?)';
  db.query(sql, [name, image, userId, price], (err, result) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    res.status(201).json({ isSuccess: true, message: '스티커 업로드 성공', stickerId: result.insertId });
  });
});

// 스티커 목록 조회
app.get('/api/stickers', (req, res) => {
  const sql = 'SELECT * FROM stickers';
  db.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    res.json({ isSuccess: true, stickers: results });
  });
});

// 사용자 스티커 목록 조회
app.get('/api/user-stickers', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const sql = 'SELECT s.* FROM stickers s INNER JOIN user_stickers us ON s.id = us.sticker_id WHERE us.user_id = ?';
  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    res.json({ isSuccess: true, stickers: results });
  });
});

app.post('/api/purchase-sticker', authenticateToken, (req, res) => {
  const { stickerId } = req.body;
  const userId = req.user.userId;

  if (!stickerId) {
    return res.status(400).json({ isSuccess: false, message: '스티커 ID를 입력해주세요.' });
  }

  const sql = 'SELECT * FROM stickers WHERE id = ?';
  db.query(sql, [stickerId], (err, results) => {
    if (err) {
      console.error('스티커 조회 오류:', err); // 로그 추가
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    if (results.length === 0) {
      return res.status(404).json({ isSuccess: false, message: '스티커 없음' });
    }

    const sticker = results[0];
    if (sticker.price > 0) {
      const getUserSql = 'SELECT coins FROM users WHERE user_id = ?';
      db.query(getUserSql, [userId], (err, results) => {
        if (err) {
          console.error('사용자 코인 조회 오류:', err); // 로그 추가
          return res.status(500).json({ isSuccess: false, message: '서버 오류' });
        }
        if (results.length === 0) {
          return res.status(404).json({ isSuccess: false, message: '사용자 없음' });
        }

        const user = results[0];
        if (user.coins < sticker.price) {
          return res.status(400).json({ isSuccess: false, message: '코인이 부족합니다.' });
        }

        const updateCoinsSql = 'UPDATE users SET coins = coins - ? WHERE user_id = ?';
        db.query(updateCoinsSql, [sticker.price, userId], (err) => {
          if (err) {
            console.error('코인 업데이트 오류:', err); // 로그 추가
            return res.status(500).json({ isSuccess: false, message: '서버 오류' });
          }

          const addStickerSql = 'INSERT INTO user_stickers (user_id, sticker_id) VALUES (?, ?)';
          db.query(addStickerSql, [userId, stickerId], (err) => {
            if (err) {
              console.error('스티커 추가 오류:', err); // 로그 추가
              return res.status(500).json({ isSuccess: false, message: '서버 오류' });
            }
            res.json({ isSuccess: true, message: '스티커 구매 성공' });
          });
        });
      });
    } else {
      res.status(400).json({ isSuccess: false, message: '무료 스티커는 구매할 수 없습니다.' });
    }
  });
});



// 사용자 정보 조회
app.get('/userinfo', authenticateToken, (req, res) => {
  const userId = req.user.userId;

  const sql = 'SELECT id, name, user_id, coins FROM users WHERE user_id = ?';
  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    if (results.length === 0) {
      return res.status(404).json({ isSuccess: false, message: '사용자 없음' });
    }
    res.json({ isSuccess: true, user: results[0] });
  });
});

// 비밀번호 변경 엔드포인트
app.post('/changepassword', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.userId;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ isSuccess: false, message: '모든 필드를 입력해주세요.' });
  }

  const sql = 'SELECT password FROM users WHERE user_id = ?';
  db.query(sql, [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ isSuccess: false, message: '서버 오류' });
    }
    if (results.length === 0) {
      return res.status(404).json({ isSuccess: false, message: '사용자 없음' });
    }

    const user = results[0];
    bcrypt.compare(currentPassword, user.password, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ isSuccess: false, message: '서버 오류' });
      }
      if (!isMatch) {
        return res.status(401).json({ isSuccess: false, message: '현재 비밀번호 불일치' });
      }

      bcrypt.hash(newPassword, saltRounds, (err, hash) => {
        if (err) {
          return res.status(500).json({ isSuccess: false, message: '서버 오류' });
        }

        const updateSql = 'UPDATE users SET password = ? WHERE user_id = ?';
        db.query(updateSql, [hash, userId], (err) => {
          if (err) {
            return res.status(500).json({ isSuccess: false, message: '서버 오류' });
          }
          res.json({ isSuccess: true, message: '비밀번호 변경 성공' });
        });
      });
    });
  });
});

// 서버 시작
app.listen(port, () => {
  console.log(`서버가 ${port} 포트에서 실행 중입니다.`);
});

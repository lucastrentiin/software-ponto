CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  jornada_minutos INT DEFAULT 480,
  intervalo_minutos INT DEFAULT 60
);

CREATE TABLE batidas (
  id SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
  horario TIMESTAMP NOT NULL,
  tipo TEXT NOT NULL,
  comprovante_url TEXT
);

CREATE TABLE backups (
  id SERIAL PRIMARY KEY,
  usuario_id INT REFERENCES usuarios(id),
  periodo_mes INT,
  periodo_ano INT,
  arquivo_url TEXT,
  criado_em TIMESTAMP DEFAULT NOW()
);

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { obfuscate } = require('./src/compiler/parser');

const PORT = process.env.PORT || 3000;
const MAX_BODY_SIZE = '512kb';

const app = express();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
        },
    },
}));

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
    methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: false, limit: MAX_BODY_SIZE }));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    keyGenerator: (req) => req.ip,
});

app.use('/api/', limiter);

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/obfuscate', (req, res) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Field "code" is required and must be a string.', requestId });
    }
    if (code.trim().length === 0) {
        return res.status(400).json({ error: 'Code cannot be empty.', requestId });
    }

    try {
        const result = obfuscate(code);
        const elapsed = Date.now() - startTime;
        return res.status(200).json({
            success: true,
            result,
            meta: {
                requestId,
                inputSize: code.length,
                outputSize: result.length,
                processingMs: elapsed,
            },
        });
    } catch (err) {
        const elapsed = Date.now() - startTime;
        const statusCode = err.code === 'PARSE_ERROR' ? 422 : 500;
        return res.status(statusCode).json({
            error: err.message,
            code: err.code || 'INTERNAL_ERROR',
            ...(err.line !== undefined && { line: err.line, column: err.column }),
            requestId,
            processingMs: elapsed,
        });
    }
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
    console.log(JSON.stringify({
        level: 'info',
        message: 'Server started',
        port: PORT,
        time: new Date().toISOString(),
    }));
});

module.exports = app;

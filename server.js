require('dotenv').config();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const DATA_ROOT = process.env.DATA_ROOT || ROOT;

const dataDir = path.join(DATA_ROOT, 'data');
const uploadDir = path.join(DATA_ROOT, 'uploads');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'site.db'));

db.pragma('journal_mode=WAL');


/* =========================================================
   DATABASE TABLES
========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS puppies(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    gender TEXT NOT NULL,
    age TEXT NOT NULL,
    price TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Available',
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS process_steps(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    step_number TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_images(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    image TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin_account(
    id INTEGER PRIMARY KEY CHECK(id=1),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
`);


/* =========================================================
   ADMIN ACCOUNT
========================================================= */

const adminEmail =
    String(
        process.env.ADMIN_EMAIL ||
        'fomagionoubosse@gmail.com'
    )
    .trim()
    .toLowerCase();

const initialPassword =
    String(
        process.env.ADMIN_PASSWORD ||
        'change-this-password'
    );

const existingAdmin = db
    .prepare('SELECT * FROM admin_account WHERE id=1')
    .get();

if (!existingAdmin) {
    db.prepare(
        `INSERT INTO admin_account
        (id,email,password_hash)
        VALUES(1,?,?)`
    ).run(
        adminEmail,
        bcrypt.hashSync(initialPassword, 12)
    );
} else {
    // Keep the stored admin email synchronized with ADMIN_EMAIL.
    db.prepare(
        `UPDATE admin_account
         SET email=?
         WHERE id=1`
    ).run(adminEmail);
}


/* =========================================================
   DEFAULT WEBSITE CONTENT
========================================================= */

[
    ['hero', 'Homepage hero image'],
    ['about', 'About section image']
].forEach(item => {
    db.prepare(
        `INSERT OR IGNORE INTO site_images
        (slot,label,image)
        VALUES(?,?,?)`
    ).run(
        item[0],
        item[1],
        ''
    );
});


const processCount = db
    .prepare('SELECT COUNT(*) c FROM process_steps')
    .get().c;

if (!processCount) {

    const q = db.prepare(
        `INSERT INTO process_steps
        (step_number,title,description)
        VALUES(?,?,?)`
    );

    q.run(
        '01',
        'Choose a puppy',
        'Review the available Golden Retriever puppies and their information.'
    );

    q.run(
        '02',
        'Ask questions',
        'Send us a text or email to discuss a puppy and ask questions.'
    );

    q.run(
        '03',
        'Arrange pickup',
        'Confirm the details and agree on a responsible handover.'
    );
}


const puppyCount = db
    .prepare('SELECT COUNT(*) c FROM puppies')
    .get().c;

if (!puppyCount) {

    const q = db.prepare(
        `INSERT INTO puppies
        (name,gender,age,price,status,description,image)
        VALUES(?,?,?,?,?,?,?)`
    );

    q.run(
        'Buddy',
        'Male',
        '10 weeks',
        '$1,800',
        'Available',
        'Friendly Golden Retriever puppy. Replace this with the real puppy information.',
        ''
    );

    q.run(
        'Daisy',
        'Female',
        '10 weeks',
        '$1,800',
        'Available',
        'Sweet Golden Retriever puppy. Replace this with the real puppy information.',
        ''
    );
}


/* =========================================================
   EXPRESS SETTINGS
========================================================= */

app.set('view engine', 'ejs');

app.set(
    'views',
    path.join(ROOT, 'views')
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(express.json());

app.use(
    express.static(
        path.join(ROOT, 'public')
    )
);

app.use(
    '/uploads',
    express.static(uploadDir)
);


/* =========================================================
   SESSION
========================================================= */

app.use(
    session({
        secret:
            process.env.SESSION_SECRET ||
            'change-this-session-secret',

        resave: false,

        saveUninitialized: false,

        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            secure:
                process.env.NODE_ENV === 'production',
            maxAge: 14400000
        }
    })
);


/* =========================================================
   IMAGE UPLOAD
========================================================= */

const upload = multer({

    storage: multer.diskStorage({

        destination: (_, __, cb) => {
            cb(null, uploadDir);
        },

        filename: (_, file, cb) => {

            const extension =
                path
                    .extname(file.originalname)
                    .toLowerCase();

            const filename =
                Date.now() +
                '-' +
                crypto
                    .randomBytes(6)
                    .toString('hex') +
                extension;

            cb(null, filename);
        }
    }),

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (_, file, cb) => {

        if (
            /^image\/(jpeg|png|webp|gif)$/
            .test(file.mimetype)
        ) {
            cb(null, true);
        } else {
            cb(
                new Error(
                    'Only JPG, PNG, WEBP, or GIF images are allowed.'
                )
            );
        }
    }
});


/* =========================================================
   HELPERS
========================================================= */

const admin = (req, res, next) => {

    if (req.session.admin) {
        return next();
    }

    return res.redirect('/admin/login');
};


const getAdmin = () => {

    return db
        .prepare(
            'SELECT * FROM admin_account WHERE id=1'
        )
        .get();
};


/* =========================================================
   RESEND EMAIL
========================================================= */

const sendPasswordResetEmail = async ({
    to,
    code
}) => {

    const apiKey =
        String(
            process.env.RESEND_API_KEY || ''
        ).trim();

    if (!apiKey) {
        throw new Error(
            'RESEND_API_KEY is not configured.'
        );
    }

    const from =
        String(
            process.env.RESEND_FROM ||
            'Sherill Kay <onboarding@resend.dev>'
        ).trim();

    const response = await fetch(
        'https://api.resend.com/emails',
        {
            method: 'POST',

            headers: {
                'Authorization':
                    `Bearer ${apiKey}`,

                'Content-Type':
                    'application/json'
            },

            body: JSON.stringify({

                from: from,

                to: [to],

                subject:
                    'Admin password reset code',

                text:
                    `Your verification code is ${code}. ` +
                    `It expires in 10 minutes.`
            })
        }
    );

    const data =
        await response
            .json()
            .catch(() => ({}));

    if (!response.ok) {

        throw new Error(
            data?.message ||
            data?.error ||
            `Resend API returned HTTP ${response.status}`
        );
    }

    return data;
};


/* =========================================================
   HOMEPAGE
========================================================= */

app.get('/', (req, res) => {

    const puppies = db
        .prepare(
            `SELECT *
             FROM puppies
             WHERE status!='Adopted'
             ORDER BY id DESC`
        )
        .all();


    const images =
        Object.fromEntries(

            db
                .prepare(
                    'SELECT slot,image FROM site_images'
                )
                .all()

                .map(item => [
                    item.slot,

                    item.image
                        ? '/uploads/' + item.image
                        : ''
                ])
        );


    const processSteps = db
        .prepare(
            'SELECT * FROM process_steps ORDER BY id'
        )
        .all();


    res.render(
        'index',
        {
            puppies,
            images,
            processSteps
        }
    );
});


/* =========================================================
   INDIVIDUAL PUPPY
========================================================= */

app.get('/puppy/:id', (req, res) => {

    const puppy = db
        .prepare(
            'SELECT * FROM puppies WHERE id=?'
        )
        .get(req.params.id);


    if (!puppy) {

        return res
            .status(404)
            .send('Puppy not found');
    }


    res.render(
        'puppy',
        {
            puppy
        }
    );
});


/* =========================================================
   ADMIN LOGIN PAGE
========================================================= */

app.get(
    '/admin/login',
    (req, res) => {

        res.render(
            'login',
            {
                error: null,
                message: null
            }
        );
    }
);


/* =========================================================
   ADMIN LOGIN
========================================================= */

app.post(
    '/admin/login',
    (req, res) => {

        const email =
            String(
                req.body.email || ''
            )
            .trim()
            .toLowerCase();


        const password =
            String(
                req.body.password || ''
            );


        const account = getAdmin();


        if (!account) {

            return res
                .status(500)
                .render(
                    'login',
                    {
                        error:
                            'Admin account is not configured.',
                        message: null
                    }
                );
        }


        const databaseEmailMatches =
            email ===
            String(account.email || '')
                .trim()
                .toLowerCase();


        const databasePasswordMatches =
            bcrypt.compareSync(
                password,
                account.password_hash
            );


        const renderEmailMatches =
            email === adminEmail;


        const renderPasswordMatches =
            password === initialPassword;


        const validDatabaseLogin =
            databaseEmailMatches &&
            databasePasswordMatches;


        const validRenderLogin =
            renderEmailMatches &&
            renderPasswordMatches;


        if (
            !validDatabaseLogin &&
            !validRenderLogin
        ) {

            return res
                .status(401)
                .render(
                    'login',
                    {
                        error:
                            'Incorrect email or password.',
                        message: null
                    }
                );
        }


        if (
            validRenderLogin &&
            !validDatabaseLogin
        ) {

            db.prepare(
                `UPDATE admin_account
                 SET email=?,
                     password_hash=?
                 WHERE id=1`
            ).run(
                adminEmail,
                bcrypt.hashSync(
                    initialPassword,
                    12
                )
            );
        }


        req.session.admin = true;

        return res.redirect('/admin');
    }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
    '/admin/logout',
    admin,
    (req, res) => {

        req.session.destroy(
            () => {
                res.redirect('/');
            }
        );
    }
);


/* =========================================================
   FORGOT PASSWORD PAGE
========================================================= */

app.get(
    '/admin/forgot-password',
    (req, res) => {

        res.render(
            'forgot-password',
            {
                error: null,
                message: null
            }
        );
    }
);


/* =========================================================
   FORGOT PASSWORD
========================================================= */

app.post(
    '/admin/forgot-password',
    async (req, res) => {

        const email =
            String(
                req.body.email || ''
            )
            .trim()
            .toLowerCase();


        const account = getAdmin();


        const genericMessage =
            'If that email is registered, a verification code has been sent.';


        if (
            !account ||
            email !==
                String(account.email || '')
                    .trim()
                    .toLowerCase()
        ) {

            return res.render(
                'forgot-password',
                {
                    error: null,
                    message: genericMessage
                }
            );
        }


        if (!process.env.RESEND_API_KEY) {

            return res.render(
                'forgot-password',
                {
                    error:
                        'Email delivery is not configured. Add RESEND_API_KEY in Render.',
                    message: null
                }
            );
        }


        const code =
            String(
                crypto.randomInt(
                    100000,
                    1000000
                )
            );


        const codeHash =
            crypto
                .createHash('sha256')
                .update(code)
                .digest('hex');


        db.prepare(
            `UPDATE password_resets
             SET used=1
             WHERE email=?
             AND used=0`
        ).run(account.email);


        db.prepare(
            `INSERT INTO password_resets
            (email,code_hash,expires_at,created_at)
            VALUES(?,?,?,?)`
        ).run(
            account.email,
            codeHash,
            Date.now() + 600000,
            Date.now()
        );


        try {

            await sendPasswordResetEmail({
                to: account.email,
                code: code
            });


            req.session.resetEmail =
                account.email;


            // IMPORTANT:
            // Go to the page where the 6-digit
            // verification code can be entered.
            return res.redirect(
                '/admin/verify-code'
            );

        } catch (error) {

            console.error(
                'Password reset email error:',
                error
            );


            return res.render(
                'forgot-password',
                {
                    error:
                        'The verification email could not be sent. Check your Resend configuration.',
                    message: null
                }
            );
        }
    }
);


/* =========================================================
   VERIFY CODE PAGE
========================================================= */

app.get(
    '/admin/verify-code',
    (req, res) => {

        if (!req.session.resetEmail) {

            return res.redirect(
                '/admin/forgot-password'
            );
        }


        res.render(
            'verify-code',
            {
                error: null
            }
        );
    }
);


/* =========================================================
   VERIFY CODE
========================================================= */

app.post(
    '/admin/verify-code',
    (req, res) => {

        if (!req.session.resetEmail) {

            return res.redirect(
                '/admin/forgot-password'
            );
        }


        const reset = db
            .prepare(
                `SELECT *
                 FROM password_resets
                 WHERE email=?
                 AND used=0
                 ORDER BY id DESC
                 LIMIT 1`
            )
            .get(
                req.session.resetEmail
            );


        const hash =
            crypto
                .createHash('sha256')
                .update(
                    String(
                        req.body.code || ''
                    )
                )
                .digest('hex');


        if (
            !reset ||
            Date.now() >
                reset.expires_at ||
            reset.attempts >= 5 ||
            hash !== reset.code_hash
        ) {

            if (reset) {

                db.prepare(
                    `UPDATE password_resets
                     SET attempts=attempts+1
                     WHERE id=?`
                ).run(reset.id);
            }


            return res
                .status(400)
                .render(
                    'verify-code',
                    {
                        error:
                            'Invalid or expired verification code.'
                    }
                );
        }


        db.prepare(
            `UPDATE password_resets
             SET used=1
             WHERE id=?`
        ).run(reset.id);


        req.session.resetVerified = true;


        return res.redirect(
            '/admin/reset-password'
        );
    }
);


/* =========================================================
   RESET PASSWORD PAGE
========================================================= */

app.get(
    '/admin/reset-password',
    (req, res) => {

        if (!req.session.resetVerified) {

            return res.redirect(
                '/admin/forgot-password'
            );
        }


        res.render(
            'reset-password',
            {
                error: null
            }
        );
    }
);


/* =========================================================
   RESET PASSWORD
========================================================= */

app.post(
    '/admin/reset-password',
    (req, res) => {

        if (!req.session.resetVerified) {

            return res.redirect(
                '/admin/forgot-password'
            );
        }


        const password =
            String(
                req.body.password || ''
            );


        const confirmation =
            String(
                req.body.confirm || ''
            );


        if (password.length < 10) {

            return res
                .status(400)
                .render(
                    'reset-password',
                    {
                        error:
                            'Password must be at least 10 characters.'
                    }
                );
        }


        if (password !== confirmation) {

            return res
                .status(400)
                .render(
                    'reset-password',
                    {
                        error:
                            'Passwords do not match.'
                    }
                );
        }


        db.prepare(
            `UPDATE admin_account
             SET password_hash=?
             WHERE id=1`
        ).run(
            bcrypt.hashSync(
                password,
                12
            )
        );


        delete req.session.resetEmail;

        delete req.session.resetVerified;


        return res.render(
            'login',
            {
                error: null,

                message:
                    'Password reset successfully. You can now log in.'
            }
        );
    }
);


/* =========================================================
   ADMIN DASHBOARD
========================================================= */

app.get(
    '/admin',
    admin,
    (req, res) => {

        res.render(
            'admin',
            {
                puppies:
                    db
                        .prepare(
                            'SELECT * FROM puppies ORDER BY id DESC'
                        )
                        .all(),

                images:
                    db
                        .prepare(
                            'SELECT * FROM site_images ORDER BY id'
                        )
                        .all(),

                processSteps:
                    db
                        .prepare(
                            'SELECT * FROM process_steps ORDER BY id'
                        )
                        .all(),

                adminEmail:
                    getAdmin().email,

                message:
                    req.query.message || ''
            }
        );
    }
);


/* =========================================================
   ADD PUPPY
========================================================= */

app.post(
    '/admin/puppies/add',
    admin,
    upload.single('image'),
    (req, res) => {

        if (
            !req.body.name ||
            !req.body.gender ||
            !req.body.age ||
            !req.body.price
        ) {

            return res.redirect(
                '/admin?message=Please+fill+all+required+fields'
            );
        }


        db.prepare(
            `INSERT INTO puppies
            (name,gender,age,price,status,description,image)
            VALUES(?,?,?,?,?,?,?)`
        ).run(
            req.body.name,
            req.body.gender,
            req.body.age,
            req.body.price,
            req.body.status ||
                'Available',
            req.body.description ||
                '',
            req.file?.filename ||
                ''
        );


        return res.redirect(
            '/admin?message=Puppy+added'
        );
    }
);


/* =========================================================
   EDIT PUPPY
========================================================= */

app.post(
    '/admin/puppies/:id/edit',
    admin,
    upload.single('image'),
    (req, res) => {

        const old = db
            .prepare(
                'SELECT * FROM puppies WHERE id=?'
            )
            .get(req.params.id);


        if (!old) {

            return res.redirect(
                '/admin?message=Puppy+not+found'
            );
        }


        const image =
            req.file?.filename ||
            old.image;


        db.prepare(
            `UPDATE puppies
             SET name=?,
                 gender=?,
                 age=?,
                 price=?,
                 status=?,
                 description=?,
                 image=?
             WHERE id=?`
        ).run(
            req.body.name,
            req.body.gender,
            req.body.age,
            req.body.price,
            req.body.status,
            req.body.description ||
                '',
            image,
            req.params.id
        );


        if (
            req.file?.filename &&
            old.image
        ) {

            fs.rm(
                path.join(
                    uploadDir,
                    old.image
                ),
                {
                    force: true
                },
                () => {}
            );
        }


        return res.redirect(
            '/admin?message=Puppy+updated'
        );
    }
);


/* =========================================================
   DELETE PUPPY
========================================================= */

app.post(
    '/admin/puppies/:id/delete',
    admin,
    (req, res) => {

        const puppy = db
            .prepare(
                'SELECT image FROM puppies WHERE id=?'
            )
            .get(req.params.id);


        db.prepare(
            'DELETE FROM puppies WHERE id=?'
        ).run(req.params.id);


        if (puppy?.image) {

            fs.rm(
                path.join(
                    uploadDir,
                    puppy.image
                ),
                {
                    force: true
                },
                () => {}
            );
        }


        return res.redirect(
            '/admin?message=Puppy+deleted'
        );
    }
);


/* =========================================================
   UPDATE WEBSITE IMAGE
========================================================= */

app.post(
    '/admin/images/:slot',
    admin,
    upload.single('image'),
    (req, res) => {

        if (!req.file) {

            return res.redirect(
                '/admin?message=Please+choose+an+image'
            );
        }


        const old = db
            .prepare(
                'SELECT image FROM site_images WHERE slot=?'
            )
            .get(req.params.slot);


        db.prepare(
            `UPDATE site_images
             SET image=?
             WHERE slot=?`
        ).run(
            req.file.filename,
            req.params.slot
        );


        if (old?.image) {

            fs.rm(
                path.join(
                    uploadDir,
                    old.image
                ),
                {
                    force: true
                },
                () => {}
            );
        }


        return res.redirect(
            '/admin?message=Website+image+updated'
        );
    }
);


/* =========================================================
   UPDATE ADOPTION PROCESS
========================================================= */

app.post(
    '/admin/process/update',
    admin,
    (req, res) => {

        const update =
            db.prepare(
                `UPDATE process_steps
                 SET title=?,
                     description=?
                 WHERE id=?`
            );


        for (let i = 1; i <= 3; i++) {

            update.run(
                req.body['title' + i],
                req.body['description' + i],
                i
            );
        }


        return res.redirect(
            '/admin?message=Adoption+process+updated'
        );
    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (err, req, res, next) => {

        if (!err) {
            return next();
        }


        console.error(err);


        return res
            .status(400)
            .send(`
                <h1>Upload error</h1>

                <p>
                    ${String(err.message)}
                </p>

                <p>
                    <a href="/admin">
                        Back to admin
                    </a>
                </p>
            `);
    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `Sherill Kay Golden Retriever site running on port ${PORT}`
        );
    }
);

/**
 * File Upload Middleware  –  src/middleware/upload.js
 *
 * Configures Multer for handling multipart/form-data uploads to the local
 * filesystem.  Uploaded images larger than 2000 px (on either axis) are
 * resized and recompressed via Sharp to keep storage and bandwidth costs low.
 *
 * Exports:
 *   uploadQuestionFiles   – Multer middleware accepting up to 5 files (field: "files")
 *   processImages         – Express middleware that resizes/compresses uploaded images
 *
 * Accepted MIME types:
 *   image/jpeg, image/png, image/gif, image/webp, application/pdf
 *
 * Limits:
 *   Per-file size: 10 MB
 *   Files per request: 5
 *
 * Upload directory:
 *   <project root>/uploads/   (created automatically if missing)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import multer from 'multer';
import sharp  from 'sharp';
import { v4 as uuidv4 } from 'uuid';

import { logger } from '../utils/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/** Absolute path to the upload destination directory. */
const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

/** Maximum file size in bytes (10 MB). */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Maximum pixel dimension before resizing kicks in. */
const MAX_IMAGE_DIMENSION = 2000;

/** JPEG quality used during Sharp compression (0–100). */
const JPEG_QUALITY = 80;

/** Allowed MIME types. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
]);

/** MIME types that Sharp can process (PDFs are stored as-is). */
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

// ─── Ensure upload directory exists ──────────────────────────────────────────

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  logger.info(`Created uploads directory: ${UPLOADS_DIR}`);
}

// ─── Multer storage ───────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  /**
   * Always write to the uploads/ directory.
   *
   * @param {import('express').Request} _req
   * @param {Express.Multer.File}       _file
   * @param {Function}                  cb
   */
  destination(_req, _file, cb) {
    cb(null, UPLOADS_DIR);
  },

  /**
   * Generate a collision-resistant filename: <uuid>.<original-extension>
   * The original name is not preserved to prevent path traversal and to
   * remove any Unicode / special-char surprises in filenames.
   *
   * @param {import('express').Request} _req
   * @param {Express.Multer.File}       file
   * @param {Function}                  cb
   */
  filename(_req, file, cb) {
    const ext      = path.extname(file.originalname).toLowerCase() || '';
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

// ─── File filter ──────────────────────────────────────────────────────────────

/**
 * Reject files whose MIME type is not in the allow-list.
 *
 * @param {import('express').Request} _req
 * @param {Express.Multer.File}       file
 * @param {multer.FileFilterCallback}  cb
 */
function fileFilter(_req, file, cb) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error(
      `סוג הקובץ "${file.mimetype}" אינו נתמך. ` +
      'ניתן להעלות תמונות (JPEG, PNG, GIF, WebP) ו-PDF בלבד.'
    );
    err.status = 415;
    cb(err, false);
  }
}

// ─── Multer instance ──────────────────────────────────────────────────────────

const multerInstance = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files:    5,
  },
});

// ─── uploadQuestionFiles ──────────────────────────────────────────────────────

/**
 * Multer middleware for question file attachments.
 * Accepts up to 5 files under the field name "files".
 *
 * Attach to a route:
 *   router.post('/questions', uploadQuestionFiles, processImages, handler);
 *
 * @type {import('express').RequestHandler}
 */
export const uploadQuestionFiles = multerInstance.array('files', 5);

// ─── processImages ────────────────────────────────────────────────────────────

/**
 * Express middleware that post-processes uploaded image files.
 *
 * For every file in req.files whose MIME type is an image:
 *   1. Reads the image with Sharp.
 *   2. If either dimension exceeds MAX_IMAGE_DIMENSION, scales it down
 *      (preserving aspect ratio) using `fit: 'inside'`.
 *   3. For JPEG/WebP output, recompresses at JPEG_QUALITY.
 *   4. Overwrites the file in-place.
 *
 * PDFs and files that do not need resizing are left untouched.
 * Any Sharp error for an individual file is logged but does NOT abort the
 * request — the original uploaded file remains available.
 *
 * Must be used after `uploadQuestionFiles` (i.e. req.files must be populated).
 *
 * @type {import('express').RequestHandler}
 */
export async function processImages(req, _res, next) {
  if (!req.files || req.files.length === 0) {
    return next();
  }

  const tasks = req.files
    .filter((file) => IMAGE_MIME_TYPES.has(file.mimetype))
    .map(async (file) => {
      try {
        const image    = sharp(file.path);
        const metadata = await image.metadata();

        const needsResize =
          (metadata.width  && metadata.width  > MAX_IMAGE_DIMENSION) ||
          (metadata.height && metadata.height > MAX_IMAGE_DIMENSION);

        let pipeline = image;

        if (needsResize) {
          pipeline = pipeline.resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, {
            fit:                'inside',
            withoutEnlargement: true,
          });
        }

        // Output format: preserve original format for PNG/GIF/WebP; JPEG otherwise
        if (file.mimetype === 'image/png') {
          pipeline = pipeline.png({ compressionLevel: 8 });
        } else if (file.mimetype === 'image/gif') {
          // Sharp does not animate GIF output — pass through as-is when no resize needed
          if (!needsResize) return;
          pipeline = pipeline.gif();
        } else {
          // image/jpeg, image/webp → output JPEG at target quality
          pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
        }

        // Write to a temporary file then replace original to avoid partial writes
        const tmpPath = `${file.path}.tmp`;
        await pipeline.toFile(tmpPath);
        fs.renameSync(tmpPath, file.path);

        logger.debug('processImages: resized/compressed image', {
          filename: file.filename,
          mimetype: file.mimetype,
          originalWidth:  metadata.width,
          originalHeight: metadata.height,
        });
      } catch (err) {
        // Non-fatal: log and continue with the original unprocessed file
        logger.warn('processImages: failed to process image', {
          filename: file.filename,
          message:  err.message,
        });
      }
    });

  await Promise.allSettled(tasks);
  return next();
}

const upload = require('./multer');
const fs = require('fs');
const path = require('path');

class UploadController {
  static uploadSingle(req, res) {
    const uploadMiddleware = upload.single('file');
    
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded'
        });
      }

      res.json({
        message: 'File uploaded successfully',
        file: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          path: req.file.path,
          url: `/uploads/${req.file.filename}`
        }
      });
    });
  }

  static uploadMultiple(req, res) {
    const uploadMiddleware = upload.array('files', 10);
    
    uploadMiddleware(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: 'No files uploaded'
        });
      }

      const files = req.files.map(file => ({
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: file.path,
        url: `/uploads/${file.filename}`
      }));

      res.json({
        message: 'Files uploaded successfully',
        files,
        count: files.length
      });
    });
  }

  static deleteFile(req, res) {
    const { filename } = req.params;
    const uploadPath = process.env.UPLOAD_PATH || './uploads';
    const filePath = path.join(uploadPath, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({
        message: 'File deleted successfully'
      });
    } else {
      res.status(404).json({
        error: 'File not found'
      });
    }
  }
}

module.exports = UploadController;

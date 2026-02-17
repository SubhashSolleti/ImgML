"""
ImgML — Flask Web Application

Handles PDF uploads, invokes the extraction engine,
and serves extracted images as a downloadable ZIP.
"""

import os
import uuid
import shutil
import zipfile
import json
from flask import (
    Flask, render_template, request, jsonify,
    send_file, url_for, abort
)
from extractor import extract_images_from_pdf

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max upload

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, 'uploads')
OUTPUT_DIR = os.path.join(BASE_DIR, 'output')

# Ensure directories exist
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {'pdf'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    """
    Accept one or more PDF files, extract images, return JSON results.
    """
    if 'files' not in request.files:
        return jsonify({'error': 'No files provided'}), 400

    files = request.files.getlist('files')

    if not files or all(f.filename == '' for f in files):
        return jsonify({'error': 'No files selected'}), 400

    # Create a session directory
    session_id = str(uuid.uuid4())
    session_upload_dir = os.path.join(UPLOAD_DIR, session_id)
    session_output_dir = os.path.join(OUTPUT_DIR, session_id)
    os.makedirs(session_upload_dir, exist_ok=True)
    os.makedirs(session_output_dir, exist_ok=True)

    all_results = []
    errors = []

    for file in files:
        if not file or file.filename == '':
            continue

        if not allowed_file(file.filename):
            errors.append(f"'{file.filename}' is not a PDF file — skipped.")
            continue

        # Save uploaded file
        safe_name = file.filename.replace(' ', '_')
        filepath = os.path.join(session_upload_dir, safe_name)
        file.save(filepath)

        try:
            # Extract images
            results = extract_images_from_pdf(filepath, session_output_dir)
            for r in results:
                r['source_pdf'] = file.filename
            all_results.extend(results)
        except Exception as e:
            errors.append(f"Error processing '{file.filename}': {str(e)}")

    if not all_results and errors:
        # Clean up on total failure
        shutil.rmtree(session_upload_dir, ignore_errors=True)
        shutil.rmtree(session_output_dir, ignore_errors=True)
        return jsonify({'error': '; '.join(errors)}), 400

    # Create ZIP file
    zip_path = os.path.join(OUTPUT_DIR, f"{session_id}.zip")
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for result in all_results:
            img_path = os.path.join(session_output_dir, result['filename'])
            if os.path.exists(img_path):
                zf.write(img_path, result['filename'])

    # Clean up uploaded files (keep output for thumbnail serving)
    shutil.rmtree(session_upload_dir, ignore_errors=True)

    response = {
        'session_id': session_id,
        'total_images': len(all_results),
        'images': all_results,
        'errors': errors,
        'download_url': url_for('download_zip', session_id=session_id),
    }

    return jsonify(response)


@app.route('/download/<session_id>')
def download_zip(session_id):
    """Stream the ZIP file for download."""
    zip_path = os.path.join(OUTPUT_DIR, f"{session_id}.zip")

    if not os.path.exists(zip_path):
        abort(404)

    return send_file(
        zip_path,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f"extracted_images_{session_id[:8]}.zip"
    )


@app.route('/thumbnail/<session_id>/<filename>')
def serve_thumbnail(session_id, filename):
    """Serve an extracted image as a thumbnail preview."""
    # Sanitize to prevent directory traversal
    if '..' in session_id or '..' in filename:
        abort(400)

    img_path = os.path.join(OUTPUT_DIR, session_id, filename)

    if not os.path.exists(img_path):
        abort(404)

    return send_file(img_path, mimetype='image/png')


@app.route('/cleanup/<session_id>', methods=['POST'])
def cleanup(session_id):
    """Clean up session files (called when user is done)."""
    if '..' in session_id:
        abort(400)

    session_output_dir = os.path.join(OUTPUT_DIR, session_id)
    zip_path = os.path.join(OUTPUT_DIR, f"{session_id}.zip")

    shutil.rmtree(session_output_dir, ignore_errors=True)
    if os.path.exists(zip_path):
        os.remove(zip_path)

    return jsonify({'status': 'cleaned up'})


if __name__ == '__main__':
    print("\n🖼️  ImgML — Research Paper Image Extractor")
    print("=" * 45)
    print("📄 Upload PDFs at: http://localhost:5000")
    print("=" * 45 + "\n")
    app.run(debug=True, port=5000)

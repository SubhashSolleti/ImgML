"""
ImgML — Flask Web Application

Handles PDF uploads, invokes the extraction engine,
and serves extracted images as downloadable ZIPs (per-PDF and combined).
"""

import os
import uuid
import shutil
import zipfile
import json
import glob
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
    Creates individual ZIPs per PDF and a combined ZIP for all.
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
    per_pdf_results = []  # List of {paper_name, results, download_url}
    errors = []

    for file in files:
        if not file or file.filename == '':
            continue

        if not allowed_file(file.filename):
            errors.append(f"'{file.filename}' is not a PDF file — skipped.")
            continue

        # Save uploaded file
        safe_name = file.filename.replace(' ', '_')
        paper_name = os.path.splitext(file.filename)[0]
        safe_paper = paper_name.replace(' ', '_')
        filepath = os.path.join(session_upload_dir, safe_name)
        file.save(filepath)

        # Create a per-PDF output subdirectory
        pdf_output_dir = os.path.join(session_output_dir, safe_paper)
        os.makedirs(pdf_output_dir, exist_ok=True)

        try:
            # Extract images into per-PDF folder
            results = extract_images_from_pdf(filepath, pdf_output_dir)
            for r in results:
                r['source_pdf'] = file.filename
                r['paper_key'] = safe_paper
            all_results.extend(results)

            # Create individual ZIP for this PDF
            if results:
                pdf_zip_name = f"{session_id}_{safe_paper}.zip"
                pdf_zip_path = os.path.join(OUTPUT_DIR, pdf_zip_name)
                with zipfile.ZipFile(pdf_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for r in results:
                        img_path = os.path.join(pdf_output_dir, r['filename'])
                        if os.path.exists(img_path):
                            zf.write(img_path, r['filename'])

                per_pdf_results.append({
                    'paper_name': paper_name,
                    'paper_key': safe_paper,
                    'image_count': len(results),
                    'images': results,
                    'download_url': url_for('download_zip',
                                            session_id=session_id,
                                            zip_key=safe_paper),
                })
            else:
                per_pdf_results.append({
                    'paper_name': paper_name,
                    'paper_key': safe_paper,
                    'image_count': 0,
                    'images': [],
                    'download_url': None,
                })

        except Exception as e:
            errors.append(f"Error processing '{file.filename}': {str(e)}")

    if not all_results and errors:
        # Clean up on total failure
        shutil.rmtree(session_upload_dir, ignore_errors=True)
        shutil.rmtree(session_output_dir, ignore_errors=True)
        return jsonify({'error': '; '.join(errors)}), 400

    # Create combined ZIP with all images (organized in folders per PDF)
    combined_zip_path = os.path.join(OUTPUT_DIR, f"{session_id}_all.zip")
    with zipfile.ZipFile(combined_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for pdf_info in per_pdf_results:
            paper_key = pdf_info['paper_key']
            for r in pdf_info['images']:
                img_path = os.path.join(session_output_dir, paper_key, r['filename'])
                if os.path.exists(img_path):
                    # Store in a subfolder named after the paper
                    zf.write(img_path, os.path.join(paper_key, r['filename']))

    # Clean up uploaded files (keep output for thumbnail serving)
    shutil.rmtree(session_upload_dir, ignore_errors=True)

    response = {
        'session_id': session_id,
        'total_images': len(all_results),
        'papers': per_pdf_results,
        'errors': errors,
        'download_all_url': url_for('download_zip',
                                     session_id=session_id,
                                     zip_key='all'),
    }

    return jsonify(response)


@app.route('/download/<session_id>/<zip_key>')
def download_zip(session_id, zip_key):
    """
    Stream a ZIP file for download.
    zip_key can be 'all' for the combined ZIP, or a paper key for individual.
    """
    if '..' in session_id or '..' in zip_key:
        abort(400)

    zip_path = os.path.join(OUTPUT_DIR, f"{session_id}_{zip_key}.zip")

    if not os.path.exists(zip_path):
        abort(404)

    if zip_key == 'all':
        download_name = "all_extracted_images.zip"
    else:
        download_name = f"{zip_key}_images.zip"

    return send_file(
        zip_path,
        mimetype='application/zip',
        as_attachment=True,
        download_name=download_name
    )


@app.route('/thumbnail/<session_id>/<paper_key>/<filename>')
def serve_thumbnail(session_id, paper_key, filename):
    """Serve an extracted image as a thumbnail preview."""
    # Sanitize to prevent directory traversal
    for part in (session_id, paper_key, filename):
        if '..' in part:
            abort(400)

    img_path = os.path.join(OUTPUT_DIR, session_id, paper_key, filename)

    if not os.path.exists(img_path):
        abort(404)

    return send_file(img_path, mimetype='image/png')


@app.route('/cleanup/<session_id>', methods=['POST'])
def cleanup(session_id):
    """Clean up session files (called when user is done)."""
    if '..' in session_id:
        abort(400)

    session_output_dir = os.path.join(OUTPUT_DIR, session_id)
    shutil.rmtree(session_output_dir, ignore_errors=True)

    # Remove all ZIP and meta files for this session
    for f in glob.glob(os.path.join(OUTPUT_DIR, f"{session_id}*.zip")):
        os.remove(f)

    return jsonify({'status': 'cleaned up'})


if __name__ == '__main__':
    print("\n🖼️  ImgML — Research Paper Image Extractor")
    print("=" * 45)
    print("📄 Upload PDFs at: http://localhost:5000")
    print("=" * 45 + "\n")
    app.run(debug=True, port=5000)

"""
ImgML — Core PDF Image Extraction Engine

Extracts images from research paper PDFs, identifies figure labels,
and saves them as PNG files with meaningful names.
"""

import os
import re
import fitz  # PyMuPDF
from PIL import Image
import io


# Regex for matching figure labels in text (case-insensitive)
FIGURE_PATTERN = re.compile(
    r'(?i)\b(?:fig(?:ure)?)\s*\.?\s*(\d+\s*[a-zA-Z]?(?:\s*[-–]\s*[a-zA-Z])?)',
    re.IGNORECASE
)


def _find_figure_label_on_page(page):
    """
    Search for figure labels on a PDF page.
    Returns a list of figure labels found (e.g., ['1', '2a', '3']).
    """
    text = page.get_text("text")
    matches = FIGURE_PATTERN.findall(text)
    # Clean up whitespace in matches
    return [m.strip() for m in matches]


def _get_image_from_xref(doc, xref):
    """
    Extract an image from the PDF by its xref number.
    Returns a PIL Image object and its metadata, or None if extraction fails.
    """
    try:
        img_info = doc.extract_image(xref)
        if not img_info:
            return None, None

        image_bytes = img_info["image"]
        image_ext = img_info.get("ext", "png")
        width = img_info.get("width", 0)
        height = img_info.get("height", 0)

        # Skip very small images (likely icons, bullets, decorations)
        if width < 50 or height < 50:
            return None, None

        # Convert to PIL Image
        pil_image = Image.open(io.BytesIO(image_bytes))

        # Convert CMYK or other modes to RGB
        if pil_image.mode in ("CMYK", "P", "LA"):
            pil_image = pil_image.convert("RGBA")
        elif pil_image.mode not in ("RGB", "RGBA"):
            pil_image = pil_image.convert("RGB")

        metadata = {
            "width": width,
            "height": height,
            "original_ext": image_ext,
        }

        return pil_image, metadata

    except Exception:
        return None, None


def extract_images_from_pdf(pdf_path, output_dir):
    """
    Extract all images from a PDF file and save them as PNG.

    Args:
        pdf_path: Path to the PDF file.
        output_dir: Directory to save extracted images.

    Returns:
        List of dicts with keys: filename, page, label, width, height
    """
    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    pdf_name = os.path.splitext(os.path.basename(pdf_path))[0]
    results = []
    seen_xrefs = set()  # Track already-extracted images to avoid duplicates
    figure_counter = 0

    for page_num in range(len(doc)):
        page = doc[page_num]

        # Find figure labels on this page
        figure_labels = _find_figure_label_on_page(page)

        # Get all images on this page
        image_list = page.get_images(full=True)

        if not image_list:
            continue

        # Track which label index to assign
        label_idx = 0

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]

            # Skip duplicates (same image referenced on multiple pages)
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            pil_image, img_meta = _get_image_from_xref(doc, xref)
            if pil_image is None:
                continue

            figure_counter += 1

            # Determine the filename
            if label_idx < len(figure_labels):
                label = figure_labels[label_idx]
                # Sanitize label for filename
                safe_label = re.sub(r'[^\w\-]', '_', label).strip('_')
                filename = f"{pdf_name}_figure_{safe_label}.png"
                label_idx += 1
            else:
                label = None
                filename = f"{pdf_name}_page{page_num + 1}_img{img_idx + 1}.png"

            # Ensure unique filename
            filepath = os.path.join(output_dir, filename)
            counter = 1
            while os.path.exists(filepath):
                base, ext = os.path.splitext(filename)
                filepath = os.path.join(output_dir, f"{base}_{counter}{ext}")
                counter += 1

            # Save as PNG
            pil_image.save(filepath, "PNG", optimize=True)

            results.append({
                "filename": os.path.basename(filepath),
                "page": page_num + 1,
                "label": f"Figure {label}" if label else f"Image (page {page_num + 1})",
                "width": img_meta["width"],
                "height": img_meta["height"],
            })

    doc.close()
    return results

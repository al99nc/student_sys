from pathlib import Path
from pypdf import PdfReader

def extract_text_from_pdf(file_path: str) -> str:
    """Extract all text from a PDF or plain-text file."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    if path.suffix.lower() == ".txt":
        text = path.read_text(encoding="utf-8", errors="replace")
        if not text.strip():
            raise ValueError("Text file is empty.")
        return text.strip()

    text = ""
    try:
        reader = PdfReader(file_path)
        for page in reader.pages:
            text += page.extract_text() or ""
    except Exception as e:
        raise ValueError(f"Failed to read PDF: {str(e)}")

    if not text.strip():
        raise ValueError("PDF appears to be empty or contains no extractable text.")

    return text.strip()

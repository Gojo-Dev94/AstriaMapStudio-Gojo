"""Create a portable editor ZIP from an explicit project and asset allowlist."""

from __future__ import annotations

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile


PROJECT = Path(__file__).resolve().parents[1]
PREFIX = Path("AstriaMapStudio-Gojo")
ROOT_FILES = (
    ".env.example",
    ".gitignore",
    "DECISIONS.md",
    "index.html",
    "INSTALLATION_BUSTA.md",
    "LICENSE.md",
    "MESSAGE_DISCORD.md",
    "openapi.yaml",
    "package.json",
    "package-lock.json",
    "README.md",
    "TECHNICAL_SPEC.md",
    "tsconfig.json",
    "vite.config.ts",
)
SOURCE_EXTENSIONS = {
    "src": {".ts", ".tsx", ".css"},
    "server": {".ts", ".sql", ".swf"},
    "scripts": {".ts", ".py"},
    "docs": {".md", ".json"},
    "dist": {".html", ".js", ".css"},
}
IMAGE_FOLDERS = ("backgrounds", "grounds", "objects")
XML_FILES = ("areas.xml", "grounds.xml", "monsters.xml", "objects.xml", "subareas.xml")


def choose_path(bundled: Path, original: Path) -> Path:
    path = bundled if bundled.is_dir() else original
    if not path.is_dir():
        raise FileNotFoundError(f"Required asset directory is missing: {path}")
    return path


def add_file(archive: ZipFile, path: Path, name: Path) -> None:
    compression = ZIP_STORED if path.suffix.lower() == ".png" else ZIP_DEFLATED
    archive.write(path, name.as_posix(), compress_type=compression)


def build_zip(output: Path) -> tuple[int, int]:
    images = choose_path(PROJECT / "assets" / "Images", PROJECT.parent.parent / "Images")
    xml = choose_path(PROJECT / "assets" / "XML", PROJECT.parent / "bin" / "AME Gojo" / "XML")
    if output.resolve().is_relative_to(PROJECT.resolve()):
        raise ValueError("Write the release ZIP outside the project folder")
    output.parent.mkdir(parents=True, exist_ok=True)
    source_count = image_count = 0
    with ZipFile(output, "w", allowZip64=True) as archive:
        for relative in ROOT_FILES:
            path = PROJECT / relative
            if not path.is_file():
                raise FileNotFoundError(path)
            add_file(archive, path, PREFIX / relative)
            source_count += 1
        for folder, allowed_extensions in SOURCE_EXTENSIONS.items():
            paths = sorted((PROJECT / folder).rglob("*"))
            if not paths:
                raise FileNotFoundError(PROJECT / folder)
            for path in paths:
                if path.is_file() and path.suffix.lower() in allowed_extensions:
                    add_file(archive, path, PREFIX / path.relative_to(PROJECT))
                    source_count += 1
        for folder in IMAGE_FOLDERS:
            paths = sorted((images / folder).rglob("*.png"))
            if not paths:
                raise FileNotFoundError(images / folder)
            for path in paths:
                add_file(archive, path, PREFIX / "assets" / "Images" / path.relative_to(images))
                image_count += 1
        for filename in XML_FILES:
            path = xml / filename
            if not path.is_file():
                raise FileNotFoundError(path)
            add_file(archive, path, PREFIX / "assets" / "XML" / filename)
            source_count += 1
    return source_count, image_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", nargs="?", type=Path, default=PROJECT.parent / "AstriaMapStudio-Gojo-portable.zip")
    args = parser.parse_args()
    other_files, png_files = build_zip(args.output)
    print(f"Created {args.output.resolve()} with {other_files} project/XML files and {png_files} PNG assets")

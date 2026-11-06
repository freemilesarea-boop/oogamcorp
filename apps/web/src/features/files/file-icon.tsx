import { File, FileArchive, FileImage, FileSpreadsheet, FileText, Presentation } from 'lucide-react';

export function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = mimeType.startsWith('image/') ? FileImage
    : mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv') ? FileSpreadsheet
      : mimeType.includes('presentation') || mimeType.includes('powerpoint') ? Presentation
        : mimeType.includes('zip') ? FileArchive
          : mimeType.includes('pdf') || mimeType.includes('word') || mimeType.startsWith('text/') || mimeType.includes('hwp') ? FileText
            : File;
  return <Icon className={className} strokeWidth={1.5} aria-hidden />;
}

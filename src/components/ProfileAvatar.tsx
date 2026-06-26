import proprietorPhoto from "@/assets/proprietor-photo.png";
import { cn } from "@/lib/utils";

export const PROPRIETOR_PHOTO_URL = proprietorPhoto;

interface ProfileAvatarProps {
  className?: string;
  alt?: string;
}

export function ProfileAvatar({ className, alt = "Proprietor" }: ProfileAvatarProps) {
  return (
    <img
      src={proprietorPhoto}
      alt={alt}
      className={cn("rounded-full object-cover bg-slate-200 ring-2 ring-white", className)}
    />
  );
}

export function downloadProprietorPhoto(filename = "proprietor-photo.png"): void {
  const link = document.createElement("a");
  link.href = proprietorPhoto;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

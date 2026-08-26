import { strings } from "@/lib/strings";

export default function Home() {
  return (
    <div className="font-sans min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        {strings.app.name}
      </h1>
      <p className="text-lg text-black/70 dark:text-white/70 max-w-md">
        {strings.app.tagline}
      </p>
    </div>
  );
}

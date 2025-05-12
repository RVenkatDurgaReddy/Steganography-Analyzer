import type {Metadata} from 'next';
// Removed: import {GeistSans} from 'geist/font/sans';
// Removed: import {GeistMono} from 'geist/font/mono';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"; 
import { ThemeProvider } from "@/components/theme-provider"; 
import { ThemeToggle } from "@/components/theme-toggle"; 

// Removed: const geistSans = GeistSans;

export const metadata: Metadata = {
  title: 'Steganography Analyzer', 
  description: 'Analyze files for potential malware threats hidden with steganography.',
  // Using a simple text-based SVG to avoid external dependencies or potential issues.
  icons: {
    icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>', 
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased font-sans"> {/* Removed geistSans.variable */}
         <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <div className="absolute top-4 right-4 z-50">
              <ThemeToggle />
            </div>
            {children}
            <Toaster /> 
         </ThemeProvider>
      </body>
    </html>
  );
}

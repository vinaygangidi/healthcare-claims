import './globals.css';

export const metadata = {
  title: 'Healthcare Claims Processing',
  description: 'Multi-agent claim adjudication and denial management system',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

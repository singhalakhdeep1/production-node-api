export const metadata = {
    title: 'Production Test Dashboard',
    description: 'Test PM2, Prometheus, Health Checks, Nginx, CI/CD',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body style={{ margin: 0, padding: 0 }}>{children}</body>
        </html>
    );
}

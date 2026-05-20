'use client';

import { useState, useEffect } from 'react';

export default function ProductionTestDashboard() {
    const [metrics, setMetrics] = useState('');
    const [health, setHealth] = useState(null);
    const [pm2Status, setPm2Status] = useState('');
    const [loading, setLoading] = useState({});

    const BASE_URL = 'http://localhost:5000';

    // Fetch Metrics
    const fetchMetrics = async () => {
        setLoading(prev => ({ ...prev, metrics: true }));
        try {
            const res = await fetch(`${BASE_URL}/metrics`);
            const text = await res.text();
            setMetrics(text);
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setLoading(prev => ({ ...prev, metrics: false }));
        }
    };

    // Check Health
    const checkHealth = async () => {
        setLoading(prev => ({ ...prev, health: true }));
        try {
            const res = await fetch(`${BASE_URL}/api/health`);
            const data = await res.json();
            setHealth(data);
        } catch (error) {
            alert('Error: ' + error.message);
        } finally {
            setLoading(prev => ({ ...prev, health: false }));
        }
    };

    // Auto-refresh health every 5 seconds
    useEffect(() => {
        checkHealth();
        const interval = setInterval(checkHealth, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div style={{ padding: '40px', fontFamily: 'system-ui', maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '10px' }}>🚀 Production Test Dashboard</h1>
            <p style={{ color: '#666', marginBottom: '30px' }}>
                Testing PM2, Prometheus Metrics, Health Checks, Nginx, CI/CD
            </p>

            {/* Health Check */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#eff6ff', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>💚 Health Status</h2>
                <button
                    onClick={checkHealth}
                    disabled={loading.health}
                    style={{
                        padding: '10px 20px',
                        background: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading.health ? 'not-allowed' : 'pointer',
                        marginBottom: '15px'
                    }}
                >
                    {loading.health ? 'Checking...' : 'Check Health'}
                </button>
                {health && (
                    <div style={{ padding: '15px', background: 'white', borderRadius: '6px', fontSize: '14px' }}>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Status:</strong> <span style={{ color: '#10b981' }}>{health.status}</span>
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                            <strong>Uptime:</strong> {Math.floor(health.uptime / 60)} minutes
                        </div>
                        <div>
                            <strong>Timestamp:</strong> {new Date(health.timestamp).toLocaleString()}
                        </div>
                    </div>
                )}
            </div>

            {/* Prometheus Metrics */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#f0fdf4', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>📊 Prometheus Metrics</h2>
                <button
                    onClick={fetchMetrics}
                    disabled={loading.metrics}
                    style={{
                        padding: '10px 20px',
                        background: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading.metrics ? 'not-allowed' : 'pointer',
                        marginBottom: '15px'
                    }}
                >
                    {loading.metrics ? 'Loading...' : 'Fetch Metrics'}
                </button>
                {metrics && (
                    <pre style={{
                        padding: '15px',
                        background: 'white',
                        borderRadius: '6px',
                        overflow: 'auto',
                        fontSize: '12px',
                        maxHeight: '400px',
                        whiteSpace: 'pre-wrap'
                    }}>
                        {metrics}
                    </pre>
                )}
            </div>

            {/* PM2 Process Manager */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#fef3c7', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>⚙️ PM2 Process Manager</h2>
                <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
                    <p><strong>PM2 Commands:</strong></p>
                    <div style={{ padding: '15px', background: 'white', borderRadius: '6px', marginTop: '10px' }}>
                        <div><code>npm run pm2:start</code> - Start app in cluster mode</div>
                        <div><code>npm run pm2:logs</code> - View logs</div>
                        <div><code>npm run pm2:monit</code> - Monitor processes</div>
                        <div><code>pm2 list</code> - List all processes</div>
                        <div><code>pm2 restart all</code> - Restart all processes</div>
                    </div>
                    <p style={{ marginTop: '15px', padding: '10px', background: 'white', borderRadius: '6px' }}>
                        💡 PM2 runs {process.env.NODE_ENV === 'production' ? 'max' : '1'} instances with auto-restart
                    </p>
                </div>
            </div>

            {/* Nginx Configuration */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#f3e8ff', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>🔧 Nginx Reverse Proxy</h2>
                <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
                    <p><strong>Setup Steps:</strong></p>
                    <ol style={{ marginLeft: '20px', marginTop: '10px' }}>
                        <li>Copy <code>nginx/nginx.conf</code> to <code>/etc/nginx/sites-available/api</code></li>
                        <li>Create symlink: <code>ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/</code></li>
                        <li>Test config: <code>sudo nginx -t</code></li>
                        <li>Reload: <code>sudo systemctl reload nginx</code></li>
                    </ol>
                    <p style={{ marginTop: '15px', padding: '10px', background: 'white', borderRadius: '6px' }}>
                        Features: Load balancing, SSL termination, rate limiting, gzip compression
                    </p>
                </div>
            </div>

            {/* Prometheus + Grafana */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#fee2e2', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>📈 Prometheus + Grafana</h2>
                <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
                    <p><strong>Start Monitoring Stack:</strong></p>
                    <div style={{ padding: '15px', background: 'white', borderRadius: '6px', marginTop: '10px' }}>
                        <div style={{ marginBottom: '10px' }}>
                            <strong>Prometheus:</strong>
                            <code style={{ display: 'block', marginTop: '5px', padding: '8px', background: '#f3f4f6', borderRadius: '4px' }}>
                                docker run -d -p 9090:9090 -v $(pwd)/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml prom/prometheus
                            </code>
                        </div>
                        <div>
                            <strong>Grafana:</strong>
                            <code style={{ display: 'block', marginTop: '5px', padding: '8px', background: '#f3f4f6', borderRadius: '4px' }}>
                                docker run -d -p 3000:3000 grafana/grafana
                            </code>
                        </div>
                    </div>
                    <p style={{ marginTop: '15px', padding: '10px', background: 'white', borderRadius: '6px' }}>
                        <strong>Access:</strong><br />
                        Prometheus: <a href="http://localhost:9090" target="_blank" style={{ color: '#3b82f6' }}>http://localhost:9090</a><br />
                        Grafana: <a href="http://localhost:3000" target="_blank" style={{ color: '#3b82f6' }}>http://localhost:3000</a> (admin/admin)
                    </p>
                </div>
            </div>

            {/* CI/CD Pipeline */}
            <div style={{ marginBottom: '30px', padding: '20px', background: '#e0f2fe', borderRadius: '8px' }}>
                <h2 style={{ fontSize: '20px', marginBottom: '15px' }}>🔄 CI/CD Pipeline</h2>
                <div style={{ fontSize: '14px', color: '#666', lineHeight: '1.8' }}>
                    <p><strong>GitHub Actions Workflow:</strong></p>
                    <ul style={{ marginLeft: '20px', marginTop: '10px' }}>
                        <li>✓ Automated testing on push/PR</li>
                        <li>✓ Docker image build</li>
                        <li>✓ Security audit (npm audit)</li>
                        <li>✓ Deploy to production (on main branch)</li>
                        <li>✓ Code coverage reports</li>
                    </ul>
                    <p style={{ marginTop: '15px', padding: '10px', background: 'white', borderRadius: '6px' }}>
                        File: <code>.github/workflows/ci-cd.yml</code>
                    </p>
                </div>
            </div>

            {/* Testing Guide */}
            <div style={{ marginTop: '40px', padding: '20px', background: '#f3f4f6', borderRadius: '8px' }}>
                <h3 style={{ fontSize: '18px', marginBottom: '15px' }}>📝 Production Checklist</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '14px' }}>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ Environment variables configured
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ SSL certificates installed
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ Prometheus scraping enabled
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ Alert rules configured
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ PM2 cluster mode active
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ Nginx load balancing
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ Rate limiting enabled
                    </div>
                    <div style={{ padding: '10px', background: 'white', borderRadius: '6px' }}>
                        ✅ CI/CD pipeline running
                    </div>
                </div>
            </div>
        </div>
    );
}

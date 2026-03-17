'use client';

export default function LoginPage() {
  return (
    <>
      <style jsx global>{`
        html,
        body {
          height: 100%;
          margin: 0;
          overflow: hidden;
        }
      `}</style>
      <style jsx>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        
        body {
          font-family: system-ui, -apple-system, sans-serif;
        }
        
        .container {
          height: 100dvh;
          width: 100vw;
          background: linear-gradient(135deg, #0d1117 0%, #1a1a2e 50%, #16213e 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          overflow: hidden;
        }
        
        .card {
          background: rgba(26, 26, 26, 0.9);
          border: 2px solid #333;
          border-radius: 16px;
          padding: 0.75rem;
          box-shadow: 0 20px 60px rgba(145, 70, 255, 0.3);
          width: min(420px, calc(100vw - 2rem));
          max-height: calc(100dvh - 2rem);
          overflow: hidden;
          backdrop-filter: blur(10px);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.5rem;
        }
        
        .title {
          font-size: clamp(1.6rem, 4vw, 2.3rem);
          font-weight: bold;
          margin: 0;
          line-height: 1.05;
          background: linear-gradient(45deg, #9146FF, #00D4FF, #FFD700);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-align: center;
        }

        .logo {
          display: block;
          width: min(85vw, 420px);
          height: auto;
          max-height: 34dvh;
          margin: 0 auto;
          object-fit: contain;
        }

        .about {
          margin-top: 0;
          padding: 10px 10px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: #e2e8f0;
        }

        .about-title {
          font-size: 14px;
          font-weight: 700;
          margin-bottom: 4px;
          color: #58a6ff;
        }

        .about-list {
          margin: 0;
          padding-left: 16px;
          color: #8b949e;
          font-size: clamp(12px, 2.2vw, 13px);
          line-height: 1.35;
        }
        
        .subtitle {
          color: #8b949e;
          font-size: clamp(0.95rem, 2.4vw, 1.2rem);
          text-align: center;
          margin: 0;
          line-height: 1.2;
        }
        
        .section-title {
          color: #58a6ff;
          margin: 0;
          font-size: clamp(1.1rem, 2.8vw, 1.4rem);
          text-align: center;
          line-height: 1.1;
        }
        
        .button {
          background: linear-gradient(45deg, #9146FF, #7c3aed);
          color: white;
          padding: 10px 18px;
          border-radius: 10px;
          text-decoration: none;
          display: block;
          width: 100%;
          text-align: center;
          border: none;
          cursor: pointer;
          font-size: 15px;
          font-weight: bold;
          margin-bottom: 0;
          transition: all 0.3s ease;
          box-shadow: 0 4px 15px rgba(145, 70, 255, 0.4);
        }
        
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(145, 70, 255, 0.6);
        }
        
        .button-discord {
          background: linear-gradient(45deg, #5865F2, #4752c4);
          box-shadow: 0 4px 15px rgba(88, 101, 242, 0.4);
        }
        
        .button-discord:hover {
          box-shadow: 0 8px 25px rgba(88, 101, 242, 0.6);
        }

        .help-text {
          color: #8b949e;
          font-size: 13px;
          line-height: 1.4;
          margin: 10px 0 20px;
          text-align: center;
        }
        
        .footer {
          text-align: center;
          margin-top: 0;
          color: #8b949e;
          font-size: 13px;
        }

        @media (max-height: 560px) {
          .container {
            align-items: flex-start;
          }

          .logo {
            max-height: 18dvh;
          }
        }
      `}</style>
      
      <div className="container">
        <div className="card">
          <img className="logo" src="/StreamWeaver.png" alt="StreamWeaver" />
          <h1 className="title">StreamWeaver</h1>
          <p className="subtitle">Local streamer automation dashboard</p>
          
          <h2 className="section-title">Sign in</h2>
          
          <a 
            href="/api/auth/twitch?role=login"
            className="button"
          >
            Connect Twitch Account
          </a>
          
          <a href="/" className="button button-discord">
            Open Dashboard
          </a>

          <div className="about">
            <div className="about-title">About StreamWeaver</div>
            <ul className="about-list">
              <li>Connect Twitch, Discord, and build automations.</li>
              <li>Runs locally (your data stays on your machine).</li>
              <li>Includes Athena AI helpers for workflows and code.</li>
            </ul>
          </div>
          
          <div className="footer">
            Powered by Space Mountain — made by Mtman1987
          </div>
        </div>
      </div>
    </>
  );
}
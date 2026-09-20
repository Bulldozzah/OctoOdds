import { useState } from "react";
import { cn } from "@/lib/utils";

export type SignInValues = { email: string; password: string };
export type SignUpValues = { fullName: string; email: string; password: string };

export type AuthSwitchProps = {
  onSignIn: (values: SignInValues) => void;
  onSignUp: (values: SignUpValues) => void;
  busy?: boolean;
  error?: string;
  notice?: string;
  /** Rendered inside the sign-in form, under the password field. */
  forgotPassword?: React.ReactNode;
  className?: string;
};

export function AuthSwitch({
  onSignIn,
  onSignUp,
  busy,
  error,
  notice,
  forgotPassword,
  className,
}: AuthSwitchProps) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [signIn, setSignIn] = useState<SignInValues>({ email: "", password: "" });
  const [signUp, setSignUp] = useState<SignUpValues>({ fullName: "", email: "", password: "" });

  return (
    <div className={cn("auth-switch", className)}>
      <style>{`
        .auth-switch {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 18px;
          padding: 20px;
        }
        .auth-switch .as-brand {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          color: #fff; text-align: center;
        }
        /* The lockup is black-on-transparent, so it needs lifting off the
           purple gradient rather than blending into it. */
        .auth-switch .as-brand-logo {
          display: block; height: 84px; width: auto;
          filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.3));
        }
        .auth-switch .as-brand-tagline {
          display: block;
          font-size: 0.9rem; font-weight: 500; letter-spacing: 0.12em;
          text-transform: uppercase; opacity: 0.9;
        }
        .auth-switch *, .auth-switch *::before, .auth-switch *::after {
          margin: 0; padding: 0; box-sizing: border-box;
        }
        .auth-switch .as-container {
          position: relative; width: 100%; max-width: 900px; height: 550px;
          background: white; border-radius: 20px;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2); overflow: hidden;
        }
        .auth-switch .forms-container { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }
        .auth-switch .signin-signup {
          position: absolute; top: 50%; transform: translate(-50%, -50%); left: 75%; width: 50%;
          transition: 1s 0.7s ease-in-out; display: grid; grid-template-columns: 1fr; z-index: 5;
        }
        .auth-switch form {
          display: flex; align-items: center; justify-content: center; flex-direction: column;
          padding: 0 5rem; transition: all 0.2s 0.7s; overflow: hidden;
          grid-column: 1 / 2; grid-row: 1 / 2;
        }
        .auth-switch form.sign-up-form { opacity: 0; z-index: 1; }
        .auth-switch form.sign-in-form { z-index: 2; }
        .auth-switch .title { font-size: 2.2rem; color: #444; margin-bottom: 10px; font-weight: 700; }
        .auth-switch .as-message {
          max-width: 380px; width: 100%; margin-top: 6px;
          font-size: 0.85rem; text-align: center; line-height: 1.35;
        }
        .auth-switch .as-message.error { color: #c02626; }
        .auth-switch .as-message.notice { color: #2f7d4f; }
        .auth-switch .input-field {
          max-width: 380px; width: 100%; background-color: #f0f0f0; margin: 10px 0; height: 55px;
          border-radius: 55px; display: grid; grid-template-columns: 15% 85%;
          padding: 0 0.4rem; position: relative; transition: 0.3s;
        }
        .auth-switch .input-field:focus-within { background-color: #e8e8e8; box-shadow: 0 0 0 2px #667eea; }
        .auth-switch .input-field i {
          text-align: center; line-height: 55px; color: #666;
          transition: 0.5s; font-size: 1.1rem; font-style: normal;
        }
        .auth-switch .input-field input {
          background: none; outline: none; border: none; line-height: 1;
          font-weight: 500; font-size: 1rem; color: #333; width: 100%;
        }
        .auth-switch .input-field input::placeholder { color: #aaa; font-weight: 400; }
        .auth-switch .as-forgot {
          max-width: 380px; width: 100%; text-align: right; padding: 2px 1rem 0 0; font-size: 0.85rem;
        }
        .auth-switch .as-forgot a { color: #667eea; font-weight: 500; text-decoration: none; }
        .auth-switch .as-forgot a:hover { text-decoration: underline; }
        .auth-switch .btn {
          width: 150px; background-color: #667eea; border: none; outline: none; height: 49px;
          border-radius: 49px; color: #fff; text-transform: uppercase; font-weight: 600;
          margin: 10px 0; cursor: pointer; transition: 0.5s; font-size: 0.9rem;
        }
        .auth-switch .btn:hover {
          background-color: #5568d3; transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .auth-switch .btn:disabled {
          opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none;
          background-color: #667eea;
        }
        .auth-switch .panels-container {
          position: absolute; height: 100%; width: 100%; top: 0; left: 0;
          display: grid; grid-template-columns: repeat(2, 1fr);
        }
        .auth-switch .panel {
          display: flex; flex-direction: column; align-items: flex-end;
          justify-content: space-around; text-align: center; z-index: 6;
        }
        .auth-switch .left-panel { pointer-events: all; padding: 3rem 17% 2rem 12%; }
        .auth-switch .right-panel { pointer-events: none; padding: 3rem 12% 2rem 17%; }
        .auth-switch .panel .content {
          color: #fff; transition: transform 0.9s ease-in-out; transition-delay: 0.6s;
        }
        .auth-switch .panel h3 { font-weight: 600; line-height: 1; font-size: 1.5rem; margin-bottom: 10px; }
        .auth-switch .panel p { font-size: 0.95rem; padding: 0.7rem 0; }
        .auth-switch .btn.transparent {
          margin: 0; background: none; border: 2px solid #fff;
          width: 130px; height: 41px; font-weight: 600; font-size: 0.8rem;
        }
        .auth-switch .btn.transparent:hover { background: rgba(255, 255, 255, 0.1); transform: translateY(-2px); }
        .auth-switch .right-panel .content { transform: translateX(800px); }
        .auth-switch .as-container:before {
          content: ""; position: absolute; height: 2000px; width: 2000px; top: -10%; right: 48%;
          transform: translateY(-50%); background: linear-gradient(-45deg, #667eea 0%, #764ba2 100%);
          transition: 1.8s ease-in-out; border-radius: 50%; z-index: 6;
        }
        .auth-switch .as-container.sign-up-mode:before { transform: translate(100%, -50%); right: 52%; }
        .auth-switch .as-container.sign-up-mode .left-panel .content { transform: translateX(-800px); }
        .auth-switch .as-container.sign-up-mode .signin-signup { left: 25%; }
        .auth-switch .as-container.sign-up-mode form.sign-up-form { opacity: 1; z-index: 2; }
        .auth-switch .as-container.sign-up-mode form.sign-in-form { opacity: 0; z-index: 1; }
        .auth-switch .as-container.sign-up-mode .right-panel .content { transform: translateX(0%); }
        .auth-switch .as-container.sign-up-mode .left-panel { pointer-events: none; }
        .auth-switch .as-container.sign-up-mode .right-panel { pointer-events: all; }
        .auth-switch .social-text { padding: 0.7rem 0; font-size: 1rem; color: #666; }
        .auth-switch .social-media { display: flex; justify-content: center; gap: 15px; }
        .auth-switch .social-icon {
          height: 46px; width: 46px; display: flex; justify-content: center; align-items: center;
          border: 1px solid #ddd; border-radius: 50%; color: #667eea; font-size: 1.2rem;
          transition: 0.3s; cursor: pointer;
        }
        .auth-switch .social-icon:hover {
          border-color: #764ba2; transform: translateY(-3px); box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        .auth-switch .social-icon svg { transition: 0.3s; }

        @media (max-width: 870px) {
          .auth-switch .as-container { min-height: 700px; height: calc(100vh - 140px); }
          .auth-switch .as-brand-logo { height: 58px; }
          .auth-switch .as-brand-tagline { font-size: 0.75rem; }
          .auth-switch .signin-signup {
            width: 100%; top: 95%; transform: translate(-50%, -100%); transition: 1s 0.8s ease-in-out;
          }
          .auth-switch .signin-signup,
          .auth-switch .as-container.sign-up-mode .signin-signup { left: 50%; }
          .auth-switch .panels-container { grid-template-columns: 1fr; grid-template-rows: 1fr 2fr 1fr; }
          .auth-switch .panel {
            flex-direction: row; justify-content: space-around; align-items: center;
            padding: 2.5rem 8%; grid-column: 1 / 2;
          }
          .auth-switch .right-panel { grid-row: 3 / 4; }
          .auth-switch .left-panel { grid-row: 1 / 2; }
          .auth-switch .panel .content {
            padding-right: 15%; transition: transform 0.9s ease-in-out; transition-delay: 0.8s;
          }
          .auth-switch .panel h3 { font-size: 1.2rem; }
          .auth-switch .panel p { font-size: 0.7rem; padding: 0.5rem 0; }
          .auth-switch .btn.transparent { width: 110px; height: 35px; font-size: 0.7rem; }
          .auth-switch .as-container:before {
            width: 1500px; height: 1500px; transform: translateX(-50%);
            left: 30%; bottom: 68%; right: initial; top: initial; transition: 2s ease-in-out;
          }
          .auth-switch .as-container.sign-up-mode:before {
            transform: translate(-50%, 100%); bottom: 32%; right: initial;
          }
          .auth-switch .as-container.sign-up-mode .left-panel .content { transform: translateY(-300px); }
          .auth-switch .as-container.sign-up-mode .right-panel .content { transform: translateY(0px); }
          .auth-switch .right-panel .content { transform: translateY(300px); }
          .auth-switch .as-container.sign-up-mode .signin-signup { top: 5%; transform: translate(-50%, 0); }
        }

        @media (max-width: 570px) {
          .auth-switch form { padding: 0 1.5rem; }
          .auth-switch .panel .content { padding: 0.5rem 1rem; }
        }
      `}</style>

      <div className="as-brand">
        <img src="/octoodds-logo.png" alt="OctoOdds" className="as-brand-logo" />
        <span className="as-brand-tagline">Even the Odds</span>
      </div>

      <div className={cn("as-container", isSignUp && "sign-up-mode")}>
        <div className="forms-container">
          <div className="signin-signup">
            <form
              className="sign-in-form"
              onSubmit={(e) => {
                e.preventDefault();
                onSignIn(signIn);
              }}
            >
              <h2 className="title">Sign in</h2>
              {!isSignUp && error && <p className="as-message error">{error}</p>}
              {!isSignUp && notice && <p className="as-message notice">{notice}</p>}
              <div className="input-field">
                <i>📧</i>
                <input
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  required
                  value={signIn.email}
                  onChange={(e) => setSignIn((s) => ({ ...s, email: e.target.value }))}
                />
              </div>
              <div className="input-field">
                <i>🔒</i>
                <input
                  type="password"
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  value={signIn.password}
                  onChange={(e) => setSignIn((s) => ({ ...s, password: e.target.value }))}
                />
              </div>
              {forgotPassword && <div className="as-forgot">{forgotPassword}</div>}
              <button type="submit" className="btn solid" disabled={busy}>
                {busy ? "Signing in…" : "Login"}
              </button>
              <p className="social-text">Or sign in with social platforms</p>
              <div className="social-media">
                <SocialIcons />
              </div>
            </form>

            <form
              className="sign-up-form"
              onSubmit={(e) => {
                e.preventDefault();
                onSignUp(signUp);
              }}
            >
              <h2 className="title">Sign up</h2>
              {isSignUp && error && <p className="as-message error">{error}</p>}
              {isSignUp && notice && <p className="as-message notice">{notice}</p>}
              <div className="input-field">
                <i>👤</i>
                <input
                  type="text"
                  placeholder="Full name"
                  autoComplete="name"
                  required
                  value={signUp.fullName}
                  onChange={(e) => setSignUp((s) => ({ ...s, fullName: e.target.value }))}
                />
              </div>
              <div className="input-field">
                <i>📧</i>
                <input
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  required
                  value={signUp.email}
                  onChange={(e) => setSignUp((s) => ({ ...s, email: e.target.value }))}
                />
              </div>
              <div className="input-field">
                <i>🔒</i>
                <input
                  type="password"
                  placeholder="Password (6+ characters)"
                  autoComplete="new-password"
                  minLength={6}
                  required
                  value={signUp.password}
                  onChange={(e) => setSignUp((s) => ({ ...s, password: e.target.value }))}
                />
              </div>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? "Creating…" : "Sign up"}
              </button>
              <p className="social-text">Or sign up with social platforms</p>
              <div className="social-media">
                <SocialIcons />
              </div>
            </form>
          </div>
        </div>

        <div className="panels-container">
          <div className="panel left-panel">
            <div className="content">
              <h3>New here?</h3>
              <p>
                Eight legs, every outcome covered. Create your OctoOdds account in seconds and start
                evening the odds.
              </p>
              <button type="button" className="btn transparent" onClick={() => setIsSignUp(true)}>
                Sign up
              </button>
            </div>
          </div>

          <div className="panel right-panel">
            <div className="content">
              <h3>One of us?</h3>
              <p>Welcome back. Sign in to keep evening the odds.</p>
              <button type="button" className="btn transparent" onClick={() => setIsSignUp(false)}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SocialIcons() {
  return (
    <>
      <a href="#" className="social-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
      </a>
      <a href="#" className="social-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="#1877F2"
        >
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>
      <a href="#" className="social-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="#1DA1F2"
        >
          <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
        </svg>
      </a>
      <a href="#" className="social-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="#0A66C2"
        >
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      </a>
    </>
  );
}

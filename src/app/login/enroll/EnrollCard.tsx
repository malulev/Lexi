import { Wordmark } from '@/components/Brand';
import '@/components/client.css';

type Props =
  | { expiredText: string }
  | {
      title: string;
      hint: string;
      keyLabel: string;
      secret: string;
      qrSvg: string;
      doneText: string;
    };

/** Presentation only; the page decides which of the two shapes it renders. */
export function EnrollCard(props: Props) {
  return (
    <main className="login login--narrow">
      <section className="login__form-panel">
        <div className="login__card">
          <Wordmark size={24} />
          {'expiredText' in props ? (
            <p className="login__error" role="alert">
              {props.expiredText}
            </p>
          ) : (
            <div className="enroll">
              <h2>{props.title}</h2>
              <p className="login__form-hint">{props.hint}</p>
              {/* The markup is the qrcode library's rendering of a URI this
                  server built from its own configuration; nothing in it came
                  from a request. */}
              <div className="enroll__qr" dangerouslySetInnerHTML={{ __html: props.qrSvg }} />
              <p className="login__form-hint">{props.keyLabel}</p>
              <p className="enroll__key" dir="ltr">
                {props.secret}
              </p>
              <a className="login__submit" href="/login">
                {props.doneText}
              </a>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

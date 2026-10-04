import sys
import json
import base64

from curl_cffi import requests as cffi_requests


REQUEST_TIMEOUT = 15


def make_request(request_data):
    url = request_data.get("url")
    method = request_data.get("method", "GET")
    headers = request_data.get("headers", {})
    cookies_str = request_data.get("cookies", "")
    data = request_data.get("data")
    is_binary_data = request_data.get("is_binary_data", False)

    cookies = {}

    if cookies_str:
        for cookie in cookies_str.split("; "):
            if "=" in cookie:
                key, value = cookie.split("=", 1)
                cookies[key] = value

    body = None

    if data:
        if is_binary_data:
            body = base64.b64decode(data)
        else:
            body = data

    try:
        print(
            json.dumps({
                "debug": f"Starting {method.upper()} request to {url}"
            }),
            file=sys.stderr
        )
        sys.stderr.flush()

        request_kwargs = {
            "headers": headers,
            "cookies": cookies,

            # Use curl_cffi's Chrome fingerprint.
            "impersonate": "chrome",

            "timeout": REQUEST_TIMEOUT
        }

        if method.upper() == "GET":
            response = cffi_requests.get(
                url,
                **request_kwargs
            )
        else:
            response = cffi_requests.post(
                url,
                data=body,
                **request_kwargs
            )

        response_body_b64 = base64.b64encode(
            response.content
        ).decode("utf-8")

        result = {
            "statusCode": response.status_code,
            "headers": dict(response.headers),
            "body": response_body_b64
        }

        print(json.dumps(result))
        sys.stdout.flush()

        print(
            json.dumps({
                "debug": (
                    f"Request finished with HTTP "
                    f"{response.status_code}"
                )
            }),
            file=sys.stderr
        )
        sys.stderr.flush()

    except Exception as e:
        error = {
            "error": str(e)
        }

        print(json.dumps(error))
        sys.stdout.flush()

        print(
            json.dumps({
                "debug": f"Request failed: {str(e)}"
            }),
            file=sys.stderr
        )
        sys.stderr.flush()


if __name__ == "__main__":

    if len(sys.argv) > 1:

        try:
            input_arg = sys.argv[1]

            if input_arg.startswith("@"):
                with open(input_arg[1:], "r") as f:
                    request_json = f.read()
            else:
                request_json = input_arg

            request_data = json.loads(request_json)

            make_request(request_data)

        except Exception as e:

            print(
                json.dumps({
                    "error": f"Invalid input: {str(e)}"
                })
            )

            sys.stdout.flush()

            sys.exit(1)

    else:

        while True:

            try:
                line = sys.stdin.readline()

                if not line:
                    break

                line = line.strip()

                if not line:
                    continue

                try:

                    request_data = json.loads(line)

                    make_request(request_data)

                except json.JSONDecodeError:

                    print(
                        json.dumps({
                            "error": "Invalid JSON input"
                        })
                    )

                    sys.stdout.flush()

                except Exception as e:

                    print(
                        json.dumps({
                            "error": f"Processing error: {str(e)}"
                        })
                    )

                    sys.stdout.flush()

            except KeyboardInterrupt:
                break

            except Exception as e:

                print(
                    json.dumps({
                        "error": f"Worker error: {str(e)}"
                    })
                )

                sys.stdout.flush()

                break
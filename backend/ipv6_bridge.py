import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

async def forward(reader, writer):
    try:
        remote_reader, remote_writer = await asyncio.open_connection("127.0.0.1", 8000)
    except Exception as e:
        writer.close()
        return

    async def pipe(r, w):
        try:
            while True:
                data = await r.read(65536)
                if not data:
                    break
                w.write(data)
                await w.drain()
        except Exception:
            pass
        finally:
            try:
                w.close()
            except Exception:
                pass

    await asyncio.gather(pipe(reader, remote_writer), pipe(remote_reader, writer))

async def main():
    try:
        server = await asyncio.start_server(forward, "::1", 8000)
        logging.info("IPv6 localhost bridge listening on [::1]:8000 -> 127.0.0.1:8000")
        async with server:
            await server.serve_forever()
    except Exception as e:
        logging.error(f"Failed to start bridge: {e}")

if __name__ == "__main__":
    asyncio.run(main())

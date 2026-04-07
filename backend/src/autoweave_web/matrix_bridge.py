from __future__ import annotations

import logging

from autoweave_web.core.settings import get_settings
from autoweave_web.db.session import init_database
from autoweave_web.services.matrix import MatrixProvisioningService, MatrixService, MatrixSyncBridge


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    init_database()
    matrix = MatrixService(settings)
    provisioning = MatrixProvisioningService(settings, matrix)
    bridge = MatrixSyncBridge(settings, matrix, provisioning)
    bridge.run_forever()


if __name__ == "__main__":
    main()

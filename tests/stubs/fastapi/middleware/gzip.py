class GZipMiddleware:
    def __init__(self, app=None, minimum_size: int = 500, compresslevel: int = 9):
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel
